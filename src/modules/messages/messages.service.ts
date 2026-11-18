/**
 * MessagesService
 *
 * Gère tout le cycle de vie du chat à l'intérieur d'un humlinker.
 *
 * ─── Actions ───────────────────────────────────────────────────────────────
 *
 *  getChat()        → charge les 30 derniers messages + activeDraft
 *  sendMessage()    → user envoie message à l'IA → IA génère/met à jour draft
 *  sendDraft()      → user clique Send → realMessage envoyé au target
 *
 * ─── Confidentialité ───────────────────────────────────────────────────────
 *  - objectiveMessage : visible par le sender dans l'interface draft
 *  - realMessage      : JAMAIS exposé au sender — uniquement stocké en DB
 *                       et transmis au target lors du Send
 *
 * ─── Draft lifecycle ───────────────────────────────────────────────────────
 *  1. Premier message → crée le Draft (version 1)
 *  2. Messages suivants → met à jour le Draft actif (même version)
 *  3. Send → marque isSent: true → crée nouveau Draft vide (version n+1)
 *  4. L'ancien draft → snapshot grisé dans le chat (ChatMessage draft_snapshot)
 */
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ChatMessage, Draft, Humlinker } from '../humlinker/entities';
import {
  AiService,
  AiUnavailableException,
  type AiContext,
  type AiNotice,
} from '../ai/ai.service';
import { MailService } from '../../integrations/mail/mail.service';
import { APP_CONFIG } from '../../config';
import configuration from '../../config/configuration';
import { NotificationsService } from '../notifications/notifications.service';
import {
  HUMLINKER_REPOSITORY,
  type HumlinkerRepository,
  type UpdateHumlinkerData,
} from '../humlinker/repositories';
import {
  CHAT_MESSAGE_REPOSITORY,
  DRAFT_REPOSITORY,
  type ChatMessageRepository,
  type DraftRepository,
} from './repositories';
import { USERS_REPOSITORY, type UsersRepository } from '../users/repositories';
import { RedisService } from '../../redis/redis.service';
import { QuotaService } from '../billing/quota.service';

/** Durée de vie du cache target-ctx : 7 jours */
const TARGET_CTX_TTL = 60 * 60 * 24 * 7;

interface TargetCtxCache {
  name: string;
  language: string;
}

const EMPTY_DRAFT_OBJECTIVE = 'Rien à transmettre pour le moment.';
const CHAT_HISTORY_LIMIT = 30;
const MAX_PAGE_SIZE = 100;
const SENT_DRAFTS_CONTEXT = 10;
/** Versions du draft actif en cache Redis (objectiveMessage + realMessage) */
const DRAFT_VERSIONS_KEY = (id: string) => `draft-versions:${id}`;
const DRAFT_VERSIONS_TTL = 60 * 60 * 24 * 7; // 7 jours
const MAX_DRAFT_VERSIONS = 20;

interface DraftVersion {
  objectiveMessage: string;
  realMessage: string;
}

export interface ChatResponse {
  /** Messages du chat triés chronologiquement (30 derniers) */
  messages: Omit<ChatMessage, never>[];
  /** Draft actif en cours (objectiveMessage uniquement — pas de realMessage) */
  activeDraft: SafeDraft | null;
  /** Indique s'il y a plus de messages à charger (scroll vers le haut) */
  hasMore: boolean;
  /** Versions du draft actif (objectiveMessage seulement, sans realMessage) */
  draftVersions: string[];
}

/** Draft exposé au sender — sans realMessage */
export interface SafeDraft {
  _id: string;
  humhlinkerId: string;
  objectiveMessage: string;
  version: number;
  isSent: boolean;
  createdAt: Date;
}

@Injectable()
export class MessagesService {
  constructor(
    @Inject(HUMLINKER_REPOSITORY)
    private readonly humlinkerRepository: HumlinkerRepository,
    @Inject(CHAT_MESSAGE_REPOSITORY)
    private readonly chatMessageRepository: ChatMessageRepository,
    @Inject(DRAFT_REPOSITORY)
    private readonly draftRepository: DraftRepository,
    @Inject(USERS_REPOSITORY)
    private readonly usersRepository: UsersRepository,
    private readonly aiService: AiService,
    private readonly notificationsService: NotificationsService,
    private readonly mailService: MailService,
    private readonly redisService: RedisService,
    private readonly quotaService: QuotaService,
    @Inject(APP_CONFIG)
    private readonly config: ReturnType<typeof configuration>,
  ) {}

  // ─── Cache Redis ──────────────────────────────────────────────────────────

  /**
   * Retourne le targetName + targetLanguage depuis le cache Redis.
   * Si absent, lit depuis le snapshot du humlinker et peuple le cache.
   */
  private async getTargetCtx(
    humhlinkerId: string,
    humlinker: Humlinker,
  ): Promise<TargetCtxCache> {
    const key = `humlinker:target-ctx:${humhlinkerId}`;
    const cached = await this.redisService.get(key);
    if (cached) {
      return JSON.parse(cached) as TargetCtxCache;
    }
    const ctx: TargetCtxCache = {
      name:
        [humlinker.target.firstName, humlinker.target.lastName]
          .filter(Boolean)
          .join(' ') || 'le destinataire',
      language: humlinker.target.language,
    };
    await this.redisService.set(key, JSON.stringify(ctx), TARGET_CTX_TTL);
    return ctx;
  }

  // ─── Lecture ──────────────────────────────────────────────────────────────

  /**
   * Charge le chat d'un humlinker.
   * Retourne les 30 derniers messages (ordre chronologique) + activeDraft (sans realMessage).
   */
  async getChat(
    humhlinkerId: string,
    userId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<ChatResponse> {
    // Contrôle d'accès : lève 403/404 si l'utilisateur n'est pas participant
    await this.getHumlinkerOrThrow(humhlinkerId, userId);

    // Pagination bornée (un limit énorme chargerait tout l'historique en mémoire)
    const limit = Math.min(
      Math.max(1, options.limit || CHAT_HISTORY_LIMIT),
      MAX_PAGE_SIZE,
    );
    const offset = Math.max(0, options.offset || 0);

    // On charge limit+1 pour savoir s'il y a une page suivante
    const messages = await this.chatMessageRepository.findByHumlinker(
      humhlinkerId,
      { limit: limit + 1, offset },
    );

    const hasMore = messages.length > limit;
    const sliced = hasMore ? messages.slice(0, limit) : messages;

    // Draft actif — on ne retourne PAS le realMessage
    const activeDraft =
      await this.draftRepository.findActiveDraft(humhlinkerId);

    const draftVersions = await this.listDraftVersionObjectives(humhlinkerId);

    return {
      messages: sliced,
      activeDraft: activeDraft ? this.toSafeDraft(activeDraft) : null,
      hasMore,
      draftVersions,
    };
  }

  // ─── Envoi d'un message à l'IA ────────────────────────────────────────────

  /**
   * Traite un message de l'utilisateur :
   * 1. Sauvegarde le message user en DB
   * 2. Construit le contexte IA (historique + drafts précédents + draft actuel)
   * 3. Appelle Gemini → reçoit objectiveMessage + realMessage
   * 4. Si draftChanged → crée ou met à jour le draft actif
   * 5. Retourne safeDraft mis à jour
   */
  async sendMessage(
    humhlinkerId: string,
    userId: string,
    content: string,
  ): Promise<{ activeDraft: SafeDraft; notice: AiNotice | null }> {
    const humlinker = await this.getHumlinkerOrThrow(humhlinkerId, userId);
    this.assertNotBlocked(humlinker);

    // 0. Quotas AVANT tout appel coûteux. L'IA est médiatrice des deux côtés :
    //    humlinker lancé par l'utilisateur → ai_reformulation,
    //    réponse dans un humlinker reçu   → ai_reply (quota séparé, plus large).
    const quotaType = humlinker.isInitiator ? 'ai_reformulation' : 'ai_reply';
    await this.quotaService.assertCanUse(userId, quotaType, {
      messageLength: content.length,
    });
    await this.quotaService.assertAiBudget();

    // 1. Contexte IA (historique AVANT le nouveau message, transmis à part)
    const chatHistory = await this.chatMessageRepository.findByHumlinker(
      humhlinkerId,
      { limit: 50 },
    );
    const lastSentDrafts = await this.draftRepository.findLastSentDrafts(
      humhlinkerId,
      SENT_DRAFTS_CONTEXT,
    );
    const currentDraft =
      await this.draftRepository.findActiveDraft(humhlinkerId);

    const senderName =
      [humlinker.sender.firstName, humlinker.sender.lastName]
        .filter(Boolean)
        .join(' ') || "L'expéditeur";

    const targetCtx = await this.getTargetCtx(humhlinkerId, humlinker);

    const aiContext: AiContext = {
      senderName,
      targetName: targetCtx.name,
      senderLanguage: humlinker.sender.language,
      targetLanguage: targetCtx.language,
      relationshipType: humlinker.relationshipType,
      lastSentDrafts,
      chatHistory,
      currentDraft,
      newMessage: content,
    };

    // 2. Appel Gemini. En cas d'échec, RIEN n'est enregistré (ni message ni
    //    quota) ; seul le coût déjà facturé par Google compte dans le budget global.
    let aiResult: Awaited<ReturnType<AiService['processUserMessage']>>;
    try {
      aiResult = await this.aiService.processUserMessage(aiContext);
    } catch (err) {
      if (err instanceof AiUnavailableException) {
        await this.quotaService.recordAiCostOnly(err.usage);
      }
      throw err;
    }
    await this.quotaService.recordAi(
      userId,
      quotaType,
      humhlinkerId,
      aiResult.usage,
    );

    // 3. Sauvegarde le message de l'utilisateur (seulement après succès)
    await this.chatMessageRepository.create({
      humhlinkerId,
      role: 'user',
      type: 'text',
      content,
    });

    // 4. Mise à jour ou création du draft
    let updatedDraft: Draft;
    if (aiResult.draftChanged) {
      if (currentDraft) {
        updatedDraft =
          (await this.draftRepository.update(currentDraft._id, {
            objectiveMessage: aiResult.objectiveMessage,
            realMessage: aiResult.realMessage,
          })) ?? currentDraft;
      } else {
        updatedDraft = await this.draftRepository.create({
          humhlinkerId,
          objectiveMessage: aiResult.objectiveMessage,
          realMessage: aiResult.realMessage,
          version: 1,
        });
      }
    } else {
      // Pas de changement de draft → on garde le draft actuel ou on crée un vide
      updatedDraft =
        currentDraft ?? (await this.createEmptyDraft(humhlinkerId, 1));
    }

    // 5. Pousse la nouvelle version dans le cache Redis
    if (aiResult.draftChanged) {
      await this.pushDraftVersion(humhlinkerId, {
        objectiveMessage: aiResult.objectiveMessage,
        realMessage: aiResult.realMessage,
      });
    }

    return {
      activeDraft: this.toSafeDraft(updatedDraft),
      notice: aiResult.notice,
    };
  }

  // ─── Restauration d'une version précédente du draft ──────────────────────

  /**
   * Remplace l'objectiveMessage du draft actif par une version précédente choisie
   * par l'utilisateur, puis régénère le realMessage via l'IA.
   * Aucune ChatMessage n'est créée (pas de nouveau message dans le chat).
   */
  async restoreDraftVersion(
    humhlinkerId: string,
    userId: string,
    versionIndex: number,
  ): Promise<{ activeDraft: SafeDraft; draftVersions: string[] }> {
    const humlinker = await this.getHumlinkerOrThrow(humhlinkerId, userId);
    this.assertNotBlocked(humlinker);

    const versions = await this.listDraftVersions(humhlinkerId);
    if (versionIndex < 0 || versionIndex >= versions.length) {
      throw new NotFoundException('Version introuvable.');
    }
    const selected = versions[versionIndex];

    // Restaure directement depuis le cache — pas d'appel IA
    const activeDraft =
      await this.draftRepository.findActiveDraft(humhlinkerId);
    let updatedDraft: Draft;
    if (activeDraft) {
      updatedDraft =
        (await this.draftRepository.update(activeDraft._id, {
          objectiveMessage: selected.objectiveMessage,
          realMessage: selected.realMessage,
        })) ?? activeDraft;
    } else {
      updatedDraft = await this.draftRepository.create({
        humhlinkerId,
        objectiveMessage: selected.objectiveMessage,
        realMessage: selected.realMessage,
        version: 1,
      });
    }

    return {
      activeDraft: this.toSafeDraft(updatedDraft),
      draftVersions: versions.map((v) => v.objectiveMessage),
    };
  }

  // ─── Envoi du draft au target ─────────────────────────────────────────────

  /**
   * Envoie le draft actif au target via le canal configuré.
   *
   * 1. Récupère le draft actif
   * 2. Marque isSent: true
   * 3. Crée un ChatMessage draft_snapshot (objectiveMessage grisé dans le chat)
   * 4. Envoie le realMessage au target via SMS/WhatsApp/email/app
   * 5. Met à jour le statut du humlinker → active
   * 6. Crée un nouveau draft vide pour la prochaine itération
   * 7. Retourne le nouveau draft vide (bouton Send inactif)
   */
  async sendDraft(humhlinkerId: string, userId: string): Promise<SafeDraft> {
    const humlinker = await this.getHumlinkerOrThrow(humhlinkerId, userId);
    this.assertNotBlocked(humlinker);

    const activeDraft =
      await this.draftRepository.findActiveDraft(humhlinkerId);
    if (
      !activeDraft ||
      activeDraft.objectiveMessage === EMPTY_DRAFT_OBJECTIVE
    ) {
      throw new NotFoundException('Aucun message à envoyer.');
    }

    // Quotas d'envoi : les réponses (humlinker reçu) ne sont pas limitées ici,
    // elles le sont déjà par le quota ai_reply.
    const emailsPlaceholder =
      humlinker.target.isPlaceholder &&
      humlinker.communicationChannel === 'email';
    if (humlinker.isInitiator) {
      await this.quotaService.assertCanUse(userId, 'message_sent');
    }
    if (emailsPlaceholder) {
      await this.quotaService.assertCanUse(userId, 'email_to_placeholder');
    }

    // 2. Marque le draft comme envoyé
    await this.draftRepository.markAsSent(activeDraft._id);

    // 3. Snapshot grisé dans le chat (objectiveMessage, sans bouton)
    await this.chatMessageRepository.create({
      humhlinkerId,
      role: 'system',
      type: 'draft_snapshot',
      content: activeDraft.objectiveMessage,
      draftId: activeDraft._id,
    });

    // 4. Envoie le realMessage au target selon le canal
    await this.dispatchToTarget(humlinker, activeDraft.realMessage);
    if (humlinker.isInitiator) {
      await this.quotaService.record(userId, 'message_sent', humhlinkerId);
    }
    if (emailsPlaceholder && humlinker.target.email) {
      await this.quotaService.record(
        userId,
        'email_to_placeholder',
        humhlinkerId,
      );
    }

    // 5. Humlinker → active + lastActivityAt
    const updateData: UpdateHumlinkerData = { lastActivityAt: new Date() };
    if (humlinker.status === 'pending') updateData.status = 'active';
    await this.humlinkerRepository.update(humhlinkerId, updateData);

    // 5b. Supprime les versions du cache (draft envoyé, on repart de zéro)
    await this.redisService.del(DRAFT_VERSIONS_KEY(humhlinkerId));

    // 6. Nouveau draft vide pour la prochaine itération
    const nextVersion = activeDraft.version + 1;
    const newDraft = await this.createEmptyDraft(humhlinkerId, nextVersion);

    return this.toSafeDraft(newDraft);
  }

  // ─── Utilitaires privés ───────────────────────────────────────────────────

  private async getHumlinkerOrThrow(
    humhlinkerId: string,
    userId: string,
  ): Promise<Humlinker> {
    const humlinker = await this.humlinkerRepository.findById(humhlinkerId);
    if (!humlinker) throw new NotFoundException('Humlinker introuvable.');
    if (humlinker.senderId !== userId && humlinker.targetId !== userId) {
      throw new ForbiddenException("Vous n'avez pas accès à ce humlinker.");
    }
    return humlinker;
  }

  private assertNotBlocked(humlinker: Humlinker): void {
    if (humlinker.status === 'blocked') {
      throw new ForbiddenException('Ce humlinker est bloqué.');
    }
  }

  // ─── Helpers versions cache ──────────────────────────────────────────────

  private async pushDraftVersion(
    humhlinkerId: string,
    version: DraftVersion,
  ): Promise<void> {
    const key = DRAFT_VERSIONS_KEY(humhlinkerId);
    const versions = await this.listDraftVersions(humhlinkerId);
    // Déduplique : ignore si identique à la dernière version
    if (
      versions.length > 0 &&
      versions[versions.length - 1].objectiveMessage ===
        version.objectiveMessage
    )
      return;
    versions.push(version);
    if (versions.length > MAX_DRAFT_VERSIONS) versions.shift();
    await this.redisService.set(
      key,
      JSON.stringify(versions),
      DRAFT_VERSIONS_TTL,
    );
  }

  private async listDraftVersions(
    humhlinkerId: string,
  ): Promise<DraftVersion[]> {
    const key = DRAFT_VERSIONS_KEY(humhlinkerId);
    const raw = await this.redisService.get(key);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as DraftVersion[];
    } catch {
      return [];
    }
  }

  private async listDraftVersionObjectives(
    humhlinkerId: string,
  ): Promise<string[]> {
    const versions = await this.listDraftVersions(humhlinkerId);
    return versions.map((v) => v.objectiveMessage);
  }

  /**
   * Dispatche le realMessage au target.
   *
   * Regle principale :
   *  - Target inscrit (non-placeholder) -> toujours via l'app (push + mirror),
   *    quel que soit le communicationChannel configure.
   *  - Target placeholder (pas de compte) -> SMS ou email one-way avec invitation
   *    a telecharger Humlinker. Le target ne peut PAS repondre depuis SMS/email.
   */
  private async dispatchToTarget(
    humlinker: Humlinker,
    realMessage: string,
  ): Promise<void> {
    const { targetId } = humlinker;
    const senderName =
      [humlinker.sender.firstName, humlinker.sender.lastName]
        .filter(Boolean)
        .join(' ') || "Quelqu'un";

    // Cas 1 : target inscrit -> app uniquement
    if (!humlinker.target.isPlaceholder) {
      const targetUser = await this.usersRepository.findById(targetId);
      if (!targetUser) return;

      if (humlinker.mirrorId) {
        await this.chatMessageRepository.create({
          humhlinkerId: humlinker.mirrorId,
          role: 'user',
          type: 'real_message',
          content: realMessage,
        });
      }

      await this.notificationsService.notifyNewMessage(
        targetId,
        targetUser.fcmToken ?? null,
        {
          humhlinkerId: humlinker.mirrorId ?? humlinker._id,
          senderName,
          messagePreview: realMessage,
        },
      );
      return;
    }

    // Cas 2 : target placeholder -> one-way SMS ou email + invitation
    const downloadUrl = this.config.app.downloadUrl;
    const { communicationChannel } = humlinker;

    if (communicationChannel === 'email') {
      const email = humlinker.target.email;
      if (!email) return;

      await this.mailService.sendHumlinkerMessage(
        email,
        senderName,
        realMessage,
        downloadUrl,
      );
      return;
    }
  }

  private async createEmptyDraft(
    humhlinkerId: string,
    version: number,
  ): Promise<Draft> {
    return this.draftRepository.create({
      humhlinkerId,
      objectiveMessage: EMPTY_DRAFT_OBJECTIVE,
      realMessage: '',
      version,
    });
  }

  private toSafeDraft(draft: Draft): SafeDraft {
    return {
      _id: draft._id,
      humhlinkerId: draft.humhlinkerId,
      objectiveMessage: draft.objectiveMessage,
      version: draft.version,
      isSent: draft.isSent,
      createdAt: draft.createdAt,
    };
  }
}
