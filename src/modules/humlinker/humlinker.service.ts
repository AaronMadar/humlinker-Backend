/**
 * HumlinkerService
 *
 * Gère toute la logique métier des humlinkers.
 *
 * ─── Routes exposées ───────────────────────────────────────────────────────
 *
 *  POST   /humlinkers                → createHumlinker()
 *  GET    /humlinkers                → getMyHumlinkers()    (liste lazy WhatsApp)
 *  GET    /humlinkers/:id            → getHumlinkerById()
 *  PATCH  /humlinkers/:id/archive    → archiveHumlinker()
 *  PATCH  /humlinkers/:id/unarchive  → unarchiveHumlinker()
 *  PATCH  /humlinkers/:id/block      → blockHumlinker()
 *
 * ─── Création d'un humlinker ──────────────────────────────────────────────
 *  1. Validation : au moins (email ou phone) OU targetUserId fourni
 *  2. Normalisation du téléphone (E.164)
 *  3. Résolution du target :
 *     a. Si targetUserId fourni → vérifie qu'il existe
 *     b. Sinon → cherche par email/phone → si trouvé lie ; sinon crée placeholder
 *  4. Vérifie qu'aucun humlinker n'existe déjà entre ces deux users
 *  5. Crée le humlinker sender (status: pending, mirrorId: null pour l'instant)
 *  6. Crée le humlinker mirror côté target (sender/target inversés)
 *  7. Lie les deux via mirrorId
 *
 * ─── Blocage ─────────────────────────────────────────────────────────────
 *  Un blocage affecte le humlinker ET son mirror → les deux sont figés.
 *  Peu importe qui bloque, l'autre côté est également bloqué.
 *
 * ─── Archive ──────────────────────────────────────────────────────────────
 *  L'archive est individuelle : chaque utilisateur archive son propre humlinker.
 *  Le mirror n'est pas affecté.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { normalizePhone } from '../../utils';
import type { Humlinker } from './entities';
import type { CreateHumlinkerDto } from './dto';
import {
  HUMLINKER_REPOSITORY,
  type HumlinkerRepository,
} from './repositories';
import {
  USERS_REPOSITORY,
  type UsersRepository,
} from '../users/repositories';
import { UsersService } from '../users/users.service';

@Injectable()
export class HumlinkerService {
  constructor(
    @Inject(HUMLINKER_REPOSITORY)
    private readonly humlinkerRepository: HumlinkerRepository,
    @Inject(USERS_REPOSITORY)
    private readonly usersRepository: UsersRepository,
    private readonly usersService: UsersService,
  ) {}

  // ─── Création ─────────────────────────────────────────────────────────────

  /**
   * Crée un humlinker entre le sender (userId) et un target.
   *
   * Étapes :
   * 1. Valide qu'on a soit targetUserId, soit au moins email ou phone
   * 2. Normalise le téléphone en E.164
   * 3. Résout le target (user existant ou nouveau placeholder)
   * 4. Vérifie qu'aucun humlinker sender→target n'existe déjà
   * 5. Crée le humlinker sender (status: pending)
   * 6. Crée le humlinker mirror (côté target)
   * 7. Lie les deux via mirrorId
   */
  async createHumlinker(
    senderId: string,
    dto: CreateHumlinkerDto,
  ): Promise<Humlinker> {
    // Étape 1 — Validation
    if (!dto.targetUserId && !dto.targetContactEmail && !dto.targetContactPhone) {
      throw new BadRequestException(
        'Vous devez fournir soit un targetUserId, soit un email ou un numéro de téléphone.',
      );
    }

    // Étape 2 — Normalisation
    const normalizedPhone = dto.targetContactPhone
      ? normalizePhone(dto.targetContactPhone)
      : null;

    if (dto.targetContactPhone && !normalizedPhone) {
      throw new BadRequestException(
        'Numéro de téléphone invalide. Utilisez le format international (+33...).',
      );
    }

    const normalizedEmail = dto.targetContactEmail
      ? dto.targetContactEmail.toLowerCase().trim()
      : null;

    // Étape 3 — Résolution du target
    const targetUser = await this.resolveTarget({
      targetUserId: dto.targetUserId,
      email: normalizedEmail,
      phone: normalizedPhone,
      senderLanguage: dto.creatorLanguage,
      targetContactName: dto.targetContactName,
    });

    if (targetUser._id === senderId) {
      throw new BadRequestException(
        'Vous ne pouvez pas créer un humlinker vers vous-même.',
      );
    }

    // Étape 4 — Unicité
    const existing = await this.humlinkerRepository.findBySenderAndTarget(
      senderId,
      targetUser._id,
    );
    if (existing) {
      throw new ConflictException('Un humlinker existe déjà avec ce contact.');
    }

    // Langue du target
    const targetLanguage =
      !targetUser.isPlaceholder && targetUser.language
        ? targetUser.language
        : (dto.targetLanguage ?? 'fr');

    // Étape 5 — Crée le humlinker sender
    const senderHumlinker = await this.humlinkerRepository.create({
      senderId,
      targetId: targetUser._id,
      communicationChannel: dto.communicationChannel,
      targetContactName: dto.targetContactName,
      targetContactEmail: normalizedEmail,
      targetContactPhone: normalizedPhone,
      relationshipType: dto.relationshipType,
      title: dto.title,
      creatorLanguage: dto.creatorLanguage,
      targetLanguage,
      status: 'pending',
    });

    // Étape 6 — Crée le humlinker mirror (côté target)
    const mirrorHumlinker = await this.humlinkerRepository.create({
      senderId: targetUser._id,
      targetId: senderId,
      communicationChannel: dto.communicationChannel,
      targetContactName: dto.targetContactName,
      targetContactEmail: null,
      targetContactPhone: null,
      relationshipType: dto.relationshipType,
      title: dto.title,
      creatorLanguage: targetLanguage,
      targetLanguage: dto.creatorLanguage,
      status: 'pending',
    });

    // Étape 7 — Lie les deux humlinkers via mirrorId
    await Promise.all([
      this.humlinkerRepository.update(senderHumlinker._id, {
        mirrorId: mirrorHumlinker._id,
      }),
      this.humlinkerRepository.update(mirrorHumlinker._id, {
        mirrorId: senderHumlinker._id,
      }),
    ]);

    return { ...senderHumlinker, mirrorId: mirrorHumlinker._id };
  }

  // ─── Lecture ──────────────────────────────────────────────────────────────

  /**
   * Retourne tous les humlinkers de l'utilisateur (sender OU target),
   * triés par lastActivityAt DESC.
   * Lazy load via offset/limit (style WhatsApp).
   */
  async getMyHumlinkers(
    userId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<Humlinker[]> {
    return this.humlinkerRepository.findAllByUserId(userId, options);
  }

  /**
   * Retourne un humlinker par son ID.
   * Vérifie que l'utilisateur est bien le sender ou le target.
   */
  async getHumlinkerById(humhlinkerId: string, userId: string): Promise<Humlinker> {
    const humlinker = await this.humlinkerRepository.findById(humhlinkerId);
    if (!humlinker) throw new NotFoundException('Humlinker introuvable.');
    this.assertParticipant(humlinker, userId);
    return humlinker;
  }

  // ─── Archive ──────────────────────────────────────────────────────────────

  /**
   * Archive un humlinker (masqué de la liste principale).
   * Individuel — le mirror n'est pas affecté.
   */
  async archiveHumlinker(humhlinkerId: string, userId: string): Promise<Humlinker> {
    const humlinker = await this.humlinkerRepository.findById(humhlinkerId);
    if (!humlinker) throw new NotFoundException('Humlinker introuvable.');
    this.assertParticipant(humlinker, userId);
    this.assertNotBlocked(humlinker);

    if (humlinker.status === 'archived') {
      throw new BadRequestException('Ce humlinker est déjà archivé.');
    }

    const updated = await this.humlinkerRepository.update(humhlinkerId, {
      status: 'archived',
    });
    return updated!;
  }

  /**
   * Désarchive un humlinker (remet dans la liste principale).
   */
  async unarchiveHumlinker(humhlinkerId: string, userId: string): Promise<Humlinker> {
    const humlinker = await this.humlinkerRepository.findById(humhlinkerId);
    if (!humlinker) throw new NotFoundException('Humlinker introuvable.');
    this.assertParticipant(humlinker, userId);

    if (humlinker.status !== 'archived') {
      throw new BadRequestException("Ce humlinker n'est pas archivé.");
    }

    const updated = await this.humlinkerRepository.update(humhlinkerId, {
      status: 'active',
    });
    return updated!;
  }

  // ─── Blocage ──────────────────────────────────────────────────────────────

  /**
   * Bloque un humlinker ET son mirror en une transaction atomique.
   * Les deux côtés sont figés — plus aucun message ne peut transiter.
   */
  async blockHumlinker(humhlinkerId: string, userId: string): Promise<void> {
    const humlinker = await this.humlinkerRepository.findById(humhlinkerId);
    if (!humlinker) throw new NotFoundException('Humlinker introuvable.');
    this.assertParticipant(humlinker, userId);
    this.assertNotBlocked(humlinker);

    if (!humlinker.mirrorId) {
      // Edge case : pas encore de mirror (race condition à la création)
      await this.humlinkerRepository.update(humhlinkerId, {
        status: 'blocked',
        blockedBy: userId,
      });
      return;
    }

    await this.humlinkerRepository.blockBoth(
      humhlinkerId,
      humlinker.mirrorId,
      userId,
    );
  }

  // ─── Utilitaires privés ───────────────────────────────────────────────────

  /**
   * Résout le target :
   *  A. targetUserId fourni → vérifie qu'il existe
   *  B. email fourni → cherche dans la DB
   *  C. téléphone fourni → cherche dans la DB
   *  D. non trouvé → crée un placeholder user
   */
  private async resolveTarget(params: {
    targetUserId?: string;
    email: string | null;
    phone: string | null;
    senderLanguage: string;
    targetContactName: string;
  }) {
    const { targetUserId, email, phone, senderLanguage, targetContactName } = params;

    if (targetUserId) {
      const user = await this.usersRepository.findById(targetUserId);
      if (!user) throw new NotFoundException('Utilisateur cible introuvable.');
      return user;
    }

    if (email) {
      const byEmail = await this.usersRepository.findByEmail(email);
      if (byEmail) return byEmail;
    }

    if (phone) {
      const byPhone = await this.usersRepository.findByPhoneNumber(phone);
      if (byPhone) return byPhone;
    }

    // Aucun utilisateur trouvé → placeholder
    const nameParts = targetContactName.trim().split(' ');
    const placeholder = await this.usersService.createPlaceholderUser({
      language: senderLanguage,
      firstName: nameParts[0] ?? null,
      lastName: nameParts.slice(1).join(' ') || null,
      email,
      phoneNumber: phone,
      placeholderSource: 'humlinker_invitation',
    });

    const full = await this.usersRepository.findById(placeholder._id);
    return full!;
  }

  private assertParticipant(humlinker: Humlinker, userId: string): void {
    if (humlinker.senderId !== userId && humlinker.targetId !== userId) {
      throw new ForbiddenException("Vous n'avez pas accès à ce humlinker.");
    }
  }

  private assertNotBlocked(humlinker: Humlinker): void {
    if (humlinker.status === 'blocked') {
      throw new BadRequestException('Ce humlinker est bloqué.');
    }
  }
}
