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
import type { AiContext } from '../ai/ai.service';
import { AiService } from '../ai/ai.service';
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

const EMPTY_DRAFT_OBJECTIVE = 'Rien à transmettre pour le moment.';
const CHAT_HISTORY_LIMIT = 30;
const SENT_DRAFTS_CONTEXT = 10;

export interface ChatResponse {
  /** Messages du chat triés chronologiquement (30 derniers) */
  messages: Omit<ChatMessage, never>[];
  /** Draft actif en cours (objectiveMessage uniquement — pas de realMessage) */
  activeDraft: SafeDraft | null;
  /** Indique s'il y a plus de messages à charger (scroll vers le haut) */
  hasMore: boolean;
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
    @Inject(APP_CONFIG)
    private readonly config: ReturnType<typeof configuration>,
  ) { }

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
    const humlinker = await this.getHumlinkerOrThrow(humhlinkerId, userId);

    const limit = options.limit ?? CHAT_HISTORY_LIMIT;
    const offset = options.offset ?? 0;

    // On charge limit+1 pour savoir s'il y a une page suivante
    const messages = await this.chatMessageRepository.findByHumlinker(
      humhlinkerId,
      { limit: limit + 1, offset },
    );

    const hasMore = messages.length > limit;
    const sliced = hasMore ? messages.slice(0, limit) : messages;

    // Draft actif — on ne retourne PAS le realMessage
    const activeDraft = await this.draftRepository.findActiveDraft(humhlinkerId);

    return {
      messages: sliced,
      activeDraft: activeDraft ? this.toSafeDraft(activeDraft) : null,
      hasMore,
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
  ): Promise<{ activeDraft: SafeDraft }> {
    const humlinker = await this.getHumlinkerOrThrow(humhlinkerId, userId);
    this.assertNotBlocked(humlinker);

    // 1. Sauvegarde le message de l'utilisateur
    await this.chatMessageRepository.create({
      humhlinkerId,
      role: 'user',
      type: 'text',
      content,
    });

    // 2. Contexte IA
    const chatHistory = await this.chatMessageRepository.findByHumlinker(
      humhlinkerId,
      { limit: 50 },
    );
    const lastSentDrafts = await this.draftRepository.findLastSentDrafts(
      humhlinkerId,
      SENT_DRAFTS_CONTEXT,
    );
    const currentDraft = await this.draftRepository.findActiveDraft(humhlinkerId);

    const senderName = [humlinker.sender.firstName, humlinker.sender.lastName]
      .filter(Boolean)
      .join(' ') || 'L\'expéditeur';

    const aiContext: AiContext = {
      senderName,
      senderLanguage: humlinker.sender.language,
      targetLanguage: humlinker.target.language,
      relationshipType: humlinker.relationshipType,
      lastSentDrafts,
      chatHistory,
      currentDraft,
      newMessage: content,
    };

    // 3. Appel Gemini
    const aiResult = await this.aiService.processUserMessage(aiContext);

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
      updatedDraft = currentDraft ?? (await this.createEmptyDraft(humhlinkerId, 1));
    }

    return { activeDraft: this.toSafeDraft(updatedDraft) };
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
  async sendDraft(
    humhlinkerId: string,
    userId: string,
  ): Promise<SafeDraft> {
    const humlinker = await this.getHumlinkerOrThrow(humhlinkerId, userId);
    this.assertNotBlocked(humlinker);

    const activeDraft = await this.draftRepository.findActiveDraft(humhlinkerId);
    if (!activeDraft || activeDraft.objectiveMessage === EMPTY_DRAFT_OBJECTIVE) {
      throw new NotFoundException('Aucun message à envoyer.');
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

    // 5. Humlinker → active + lastActivityAt
    const updateData: UpdateHumlinkerData = { lastActivityAt: new Date() };
    if (humlinker.status === 'pending') updateData.status = 'active';
    await this.humlinkerRepository.update(humhlinkerId, updateData);

    // 6. Nouveau draft vide pour la prochaine itération
    const nextVersion = activeDraft.version + 1;
    const newDraft = await this.createEmptyDraft(humhlinkerId, nextVersion);

    return this.toSafeDraft(newDraft);
  }

  // ─── Réception d'une réponse du target (appelé par WebhookService) ────────

  /**
   * Traite un message entrant du target (reçu via webhook Twilio).
   * Appelé depuis WebhookService après identification du mirror humlinker.
   *
   * 1. Sauvegarde le message du target dans le mirror humlinker
   * 2. L'IA génère le draft côté mirror (objectiveMessage + realMessage)
   * 3. Notifie le sender original : WebSocket + FCM
   */
  async processIncomingTargetMessage(
    mirrorHumhlinkerId: string,
    targetRawMessage: string,
    senderUserId: string, // userId du sender original à notifier
    senderFcmToken: string | null,
    senderName: string,
  ): Promise<void> {
    // 1. Sauvegarde le message brut du target dans le mirror
    await this.chatMessageRepository.create({
      humhlinkerId: mirrorHumhlinkerId,
      role: 'user',
      type: 'text',
      content: targetRawMessage,
    });

    // 2. Génération du draft côté mirror
    const mirrorHumlinker = await this.humlinkerRepository.findById(mirrorHumhlinkerId);
    if (!mirrorHumlinker) return;

    // ─── Stockage de la réponse du target dans le chat du SENDER ────────────
    // Quand le target répond, le sender doit voir cette réponse dans son propre
    // chat (type: 'target_reply') afin que l'IA en tienne compte au prochain message.
    if (mirrorHumlinker.mirrorId) {
      await this.chatMessageRepository.create({
        humhlinkerId: mirrorHumlinker.mirrorId, // chat original du sender
        role: 'system',
        type: 'target_reply',
        content: targetRawMessage,
      });
    }

    const chatHistory = await this.chatMessageRepository.findByHumlinker(
      mirrorHumhlinkerId,
      { limit: 50 },
    );
    const lastSentDrafts = await this.draftRepository.findLastSentDrafts(
      mirrorHumhlinkerId,
      SENT_DRAFTS_CONTEXT,
    );
    const currentDraft = await this.draftRepository.findActiveDraft(mirrorHumhlinkerId);

    const mirrorSenderName = [mirrorHumlinker.sender.firstName, mirrorHumlinker.sender.lastName]
      .filter(Boolean)
      .join(' ') || 'L\'expéditeur';

    const aiResult = await this.aiService.processUserMessage({
      senderName: mirrorSenderName,
      senderLanguage: mirrorHumlinker.sender.language,
      targetLanguage: mirrorHumlinker.target.language,
      relationshipType: mirrorHumlinker.relationshipType,
      lastSentDrafts,
      chatHistory,
      currentDraft,
      newMessage: targetRawMessage,
    });

    // Mise à jour du draft miroir
    if (aiResult.draftChanged) {
      if (currentDraft) {
        await this.draftRepository.update(currentDraft._id, {
          objectiveMessage: aiResult.objectiveMessage,
          realMessage: aiResult.realMessage,
        });
      } else {
        await this.draftRepository.create({
          humhlinkerId: mirrorHumhlinkerId,
          objectiveMessage: aiResult.objectiveMessage,
          realMessage: aiResult.realMessage,
          version: 1,
        });
      }
    }

    // 3. Notifie le sender original du réel message reçu (realMessage du target)
    // Le sender reçoit directement le realMessage (pas l'objectiveMessage du target)
    await this.notificationsService.notifyNewMessage(
      senderUserId,
      senderFcmToken,
      {
        humhlinkerId: mirrorHumlinker.mirrorId ?? mirrorHumhlinkerId,
        senderName,
        messagePreview: aiResult.realMessage,
      },
    );

    // Mise à jour lastActivityAt des deux côtés
    await this.humlinkerRepository.update(mirrorHumhlinkerId, {
      lastActivityAt: new Date(),
      status: mirrorHumlinker.status === 'pending' ? 'active' : undefined,
    });
    if (mirrorHumlinker.mirrorId) {
      await this.humlinkerRepository.update(mirrorHumlinker.mirrorId, {
        lastActivityAt: new Date(),
      });
    }
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
    const senderName = [humlinker.sender.firstName, humlinker.sender.lastName]
      .filter(Boolean)
      .join(' ') || 'Quelqu\'un';

    // Cas 1 : target inscrit -> app uniquement
    if (!humlinker.target.isPlaceholder) {
      const targetUser = await this.usersRepository.findById(targetId);
      if (!targetUser) return;

      if (humlinker.mirrorId) {
        // type 'real_message' = message reçu du sender → toujours à gauche dans le chat du target
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

// }