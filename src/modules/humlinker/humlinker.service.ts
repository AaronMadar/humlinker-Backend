import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomBytes } from 'crypto';
import type { Humlinker, HumlinkerParticipant } from './entities';
import type { CreateHumlinkerDto } from './dto';
import { HUMLINKER_REPOSITORY, type HumlinkerRepository } from './repositories';
import { USERS_REPOSITORY, type UsersRepository } from '../users/repositories';
import type { User } from '../users/entities';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { USER_PLACEHOLDER_UPGRADED, type UserPlaceholderUpgradedEvent } from '../../events';

const PIN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

@Injectable()
export class HumlinkerService {
  private readonly logger = new Logger(HumlinkerService.name);

  constructor(
    @Inject(HUMLINKER_REPOSITORY)
    private readonly humlinkerRepository: HumlinkerRepository,
    @Inject(USERS_REPOSITORY)
    private readonly usersRepository: UsersRepository,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createHumlinker(senderId: string, dto: CreateHumlinkerDto): Promise<Humlinker> {
    if (!dto.targetUserId && !dto.targetContactEmail) {
      throw new BadRequestException(
        'Vous devez fournir soit un targetUserId (utilisateur inscrit) soit un email (non-inscrit).',
      );
    }

    const normalizedEmail = dto.targetContactEmail
      ? dto.targetContactEmail.toLowerCase().trim()
      : null;

    const targetContactName = [dto.targetFirstName, dto.targetLastName].filter(Boolean).join(' ');
    const title = 'Humlink - ' + targetContactName;

    const senderUser = await this.usersRepository.findById(senderId);
    if (!senderUser) throw new NotFoundException('Utilisateur introuvable.');

    const targetUser = await this.resolveTarget({
      targetUserId: dto.targetUserId,
      email: normalizedEmail,
      senderLanguage: senderUser.language,
      targetFirstName: dto.targetFirstName,
      targetLastName: dto.targetLastName,
    });

    if (targetUser._id === senderId) {
      throw new BadRequestException('Vous ne pouvez pas créer un humlinker vers vous-même.');
    }

    const targetLanguage = !targetUser.isPlaceholder ? targetUser.language : dto.targetLanguage;

    const senderSnapshot: HumlinkerParticipant = this.toParticipantSnapshot(senderUser);
    const targetSnapshot: HumlinkerParticipant = {
      ...this.toParticipantSnapshot(targetUser),
      language: targetLanguage,
    };

    const existing = await this.humlinkerRepository.findBySenderAndTarget(senderId, targetUser._id);
    if (existing) {
      if (existing.status === 'archived') {
        // Réactivation : remet pending + corrige isInitiator
        const updated = await this.humlinkerRepository.update(existing._id, { status: 'pending', isInitiator: true });
        if (existing.mirrorId) {
          const mirrorUpdated = await this.humlinkerRepository.update(existing.mirrorId, { status: 'pending', isInitiator: false });
          if (mirrorUpdated) {
            this.notificationsService.notifyInvitationReceived(existing.targetId, mirrorUpdated);
          }
        }
        return updated!;
      }
      throw new ConflictException('Un humlinker existe déjà avec ce contact.');
    }

    const senderHumlinker = await this.humlinkerRepository.create({
      senderId,
      targetId: targetUser._id,
      communicationChannel: dto.communicationChannel,
      targetContactName,
      relationshipType: dto.relationshipType,
      title,
      senderSnapshot,
      targetSnapshot,
      isInitiator: true,
      status: 'pending',
    });

    const mirrorTargetContactName =
      [senderUser.firstName, senderUser.lastName].filter(Boolean).join(' ') || targetContactName;

    const mirrorHumlinker = await this.humlinkerRepository.create({
      senderId: targetUser._id,
      targetId: senderId,
      communicationChannel: dto.communicationChannel,
      targetContactName: mirrorTargetContactName,
      relationshipType: dto.relationshipType,
      title,
      senderSnapshot: targetSnapshot,
      targetSnapshot: senderSnapshot,
      isInitiator: false,
      status: 'pending',
    });

    await Promise.all([
      this.humlinkerRepository.update(senderHumlinker._id, { mirrorId: mirrorHumlinker._id }),
      this.humlinkerRepository.update(mirrorHumlinker._id, { mirrorId: senderHumlinker._id }),
    ]);

    // Notifie le destinataire en temps réel
    const mirrorWithLinks = { ...mirrorHumlinker, mirrorId: senderHumlinker._id };
    this.notificationsService.notifyInvitationReceived(targetUser._id, mirrorWithLinks);

    return { ...senderHumlinker, mirrorId: mirrorHumlinker._id };
  }

  async getMyHumlinkers(userId: string, options: { limit?: number; offset?: number } = {}): Promise<Humlinker[]> {
    return this.humlinkerRepository.findAllByUserId(userId, options);
  }

  async getHumlinkerById(humhlinkerId: string, userId: string): Promise<Humlinker> {
    const humlinker = await this.humlinkerRepository.findById(humhlinkerId);
    if (!humlinker) throw new NotFoundException('Humlinker introuvable.');
    this.assertParticipant(humlinker, userId);
    return humlinker;
  }

  async archiveHumlinker(humhlinkerId: string, userId: string): Promise<Humlinker> {
    const humlinker = await this.humlinkerRepository.findById(humhlinkerId);
    if (!humlinker) throw new NotFoundException('Humlinker introuvable.');
    this.assertParticipant(humlinker, userId);
    this.assertNotBlocked(humlinker);
    if (humlinker.status === 'archived') throw new BadRequestException('Déjà archivé.');
    const updated = await this.humlinkerRepository.update(humhlinkerId, { status: 'archived' });
    return updated!;
  }

  async unarchiveHumlinker(humhlinkerId: string, userId: string): Promise<Humlinker> {
    const humlinker = await this.humlinkerRepository.findById(humhlinkerId);
    if (!humlinker) throw new NotFoundException('Humlinker introuvable.');
    this.assertParticipant(humlinker, userId);
    if (humlinker.status !== 'archived') throw new BadRequestException("Ce humlinker n'est pas archivé.");
    const updated = await this.humlinkerRepository.update(humhlinkerId, { status: 'active' });
    return updated!;
  }

  async acceptInvitation(humhlinkerId: string, userId: string): Promise<Humlinker> {
    const humlinker = await this.humlinkerRepository.findById(humhlinkerId);
    if (!humlinker) throw new NotFoundException('Humlinker introuvable.');
    this.assertParticipant(humlinker, userId);
    if (humlinker.isInitiator) {
      throw new ForbiddenException("Seul le destinataire peut accepter l'invitation.");
    }
    if (humlinker.status !== 'pending') {
      throw new BadRequestException('Ce humlinker ne peut pas être accepté (statut non pending).');
    }
    const updated = await this.humlinkerRepository.update(humhlinkerId, { status: 'active' });
    if (humlinker.mirrorId) {
      await this.humlinkerRepository.update(humlinker.mirrorId, { status: 'active' });
      const initiatorRecord = await this.humlinkerRepository.findById(humlinker.mirrorId);
      if (initiatorRecord) {
        this.notificationsService.notifyHumlinkerStatusChanged(
          initiatorRecord.senderId,
          humlinker.mirrorId,
          'active',
        );
      }
    }
    return updated!;
  }

  async declineInvitation(humhlinkerId: string, userId: string): Promise<void> {
    const humlinker = await this.humlinkerRepository.findById(humhlinkerId);
    if (!humlinker) throw new NotFoundException('Humlinker introuvable.');
    this.assertParticipant(humlinker, userId);
    if (humlinker.isInitiator) {
      throw new ForbiddenException("Seul le destinataire peut refuser l'invitation.");
    }
    if (humlinker.status !== 'pending') {
      throw new BadRequestException('Ce humlinker ne peut pas être refusé (statut non pending).');
    }
    await this.humlinkerRepository.update(humhlinkerId, { status: 'archived' });
    if (humlinker.mirrorId) {
      await this.humlinkerRepository.update(humlinker.mirrorId, { status: 'archived' });
      const initiatorRecord = await this.humlinkerRepository.findById(humlinker.mirrorId);
      if (initiatorRecord) {
        this.notificationsService.notifyHumlinkerStatusChanged(
          initiatorRecord.senderId,
          humlinker.mirrorId,
          'archived',
        );
      }
    }
  }

  async cancelInvitation(humhlinkerId: string, userId: string): Promise<void> {
    const humlinker = await this.humlinkerRepository.findById(humhlinkerId);
    if (!humlinker) throw new NotFoundException('Humlinker introuvable.');
    this.assertParticipant(humlinker, userId);
    if (!humlinker.isInitiator) {
      throw new ForbiddenException("Seul l'expéditeur peut annuler l'invitation.");
    }
    if (humlinker.status !== 'pending') {
      throw new BadRequestException('Ce humlinker ne peut pas être annulé (statut non pending).');
    }
    await this.humlinkerRepository.update(humhlinkerId, { status: 'archived' });
    if (humlinker.mirrorId) {
      await this.humlinkerRepository.update(humlinker.mirrorId, { status: 'archived' });
      const mirrorRecord = await this.humlinkerRepository.findById(humlinker.mirrorId);
      if (mirrorRecord) {
        this.notificationsService.notifyHumlinkerStatusChanged(
          mirrorRecord.senderId,
          humlinker.mirrorId,
          'archived',
        );
      }
    }
  }

  async blockHumlinker(humhlinkerId: string, userId: string): Promise<void> {
    const humlinker = await this.humlinkerRepository.findById(humhlinkerId);
    if (!humlinker) throw new NotFoundException('Humlinker introuvable.');
    this.assertParticipant(humlinker, userId);
    this.assertNotBlocked(humlinker);
    if (!humlinker.mirrorId) {
      await this.humlinkerRepository.update(humhlinkerId, { status: 'blocked', blockedBy: userId });
      return;
    }
    await this.humlinkerRepository.blockBoth(humhlinkerId, humlinker.mirrorId, userId);
  }

  @OnEvent(USER_PLACEHOLDER_UPGRADED)
  async onPlaceholderUpgraded(event: UserPlaceholderUpgradedEvent): Promise<void> {
    const upgradedSnapshot: HumlinkerParticipant = {
      userId: event.userId,
      firstName: event.firstName,
      lastName: event.lastName,
      email: event.email,
      language: event.language,
      gender: event.gender,
      profilePicture: event.profilePicture,
      isPlaceholder: false,
    };

    const asTarget = await this.humlinkerRepository.findAllByTargetId(event.userId);
    if (asTarget.length > 0) {
      await Promise.all(
        asTarget.flatMap((h) => {
          const needsChannelSwitch = h.communicationChannel !== 'app' && h.status !== 'blocked';
          const updates = [
            this.humlinkerRepository.update(h._id, {
              targetSnapshot: upgradedSnapshot,
              ...(needsChannelSwitch && { communicationChannel: 'app' }),
            }),
          ];
          if (h.mirrorId) {
            updates.push(
              this.humlinkerRepository.update(h.mirrorId, {
                senderSnapshot: upgradedSnapshot,
                ...(needsChannelSwitch && { communicationChannel: 'app' }),
              }),
            );
          }
          return updates;
        }),
      );
    }

    const asSender = await this.humlinkerRepository.findAllBySenderId(event.userId);
    if (asSender.length > 0) {
      await Promise.all(
        asSender.flatMap((h) => {
          const updates = [
            this.humlinkerRepository.update(h._id, { senderSnapshot: upgradedSnapshot }),
          ];
          if (h.mirrorId) {
            updates.push(
              this.humlinkerRepository.update(h.mirrorId, { targetSnapshot: upgradedSnapshot }),
            );
          }
          return updates;
        }),
      );
    }
  }

  private toParticipantSnapshot(user: User): HumlinkerParticipant {
    return {
      userId: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      language: user.language,
      gender: user.gender,
      profilePicture: user.profilePicture,
      isPlaceholder: user.isPlaceholder,
    };
  }

  private async resolveTarget(params: {
    targetUserId?: string;
    email: string | null;
    senderLanguage: string;
    targetFirstName: string;
    targetLastName?: string;
  }) {
    const { targetUserId, email, senderLanguage, targetFirstName, targetLastName } = params;

    if (targetUserId) {
      const user = await this.usersRepository.findById(targetUserId);
      if (!user) throw new NotFoundException('Utilisateur cible introuvable.');
      return user;
    }

    if (email) {
      const byEmail = await this.usersRepository.findByEmail(email);
      if (byEmail) return byEmail;
    }

    const bytes = randomBytes(8);
    const pin = Array.from(bytes).map(b => PIN_CHARS[b % PIN_CHARS.length]).join('');

    const placeholder = await this.usersService.createPlaceholderUser({
      pin,
      language: senderLanguage,
      firstName: targetFirstName,
      lastName: targetLastName ?? null,
      email,
      phoneNumber: null,
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
