import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcrypt';
import {
  sanitizeUser,
  toPublicUser,
  type PublicUser,
  type SafeUser,
} from '@/utils';
import {
  UserPlaceholderUpgradedEvent,
  USER_PLACEHOLDER_UPGRADED,
} from '@/events';
import type { User, UserPlaceholderSource } from './entities';
import type { UpdatePasswordDto } from './dto/update-password.dto';
import type { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import type { UpdateEmailDto } from './dto/update-email.dto';
import type { UpdatePhoneDto } from './dto/update-phone.dto';
import type { SearchUsersQueryDto } from './dto/search-users-query.dto';
import {
  USERS_REPOSITORY,
  type CreateUserData,
  type UsersRepository,
} from './repositories';
import { OtpService } from '../auth/services/otp.service';
import { RedisService } from '../../redis/redis.service';
import { PrismaService } from '../../database';
import { SessionService } from '../auth/sessions/session.service';

const BCRYPT_ROUNDS = 10;

export interface CreatePlaceholderUserInput {
  language: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
  gender?: User['gender'];
  placeholderSource?: UserPlaceholderSource;
  pin: string;
}

export interface UpgradePlaceholderUserInput {
  email?: string | null;
  phoneNumber?: string | null;
  password?: string;
  firstName?: string | null;
  lastName?: string | null;
  gender?: User['gender'];
  language?: string;
  profilePicture?: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(USERS_REPOSITORY)
    private readonly usersRepository: UsersRepository,
    private readonly otpService: OtpService,
    private readonly eventEmitter: EventEmitter2,
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  async getMe(userId: string): Promise<SafeUser> {
    const user = await this.findUserOrThrow(userId);
    return sanitizeUser(user);
  }

  async getUserById(id: string): Promise<SafeUser> {
    const user = await this.findUserOrThrow(id);
    return sanitizeUser(user);
  }

  async updateUserProfile(
    userId: string,
    dto: UpdateUserProfileDto,
  ): Promise<SafeUser> {
    const updated = await this.usersRepository.update(userId, {
      firstName: dto.firstName,
      lastName: dto.lastName,
      language: dto.language,
      profilePicture: dto.profilePicture,
      gender: dto.gender,
    });
    if (!updated) throw new NotFoundException('Utilisateur introuvable.');

    // Synchronise tous les snapshots (sender + target) et invalide le cache Redis
    await this.syncProfileSnapshots(updated);

    return sanitizeUser(updated);
  }

  /**
   * Répercute le profil (nom, langue, genre, photo) sur les « photos » stockées
   * dans les humlinkers, côté target ET côté sender, pour un affichage à jour.
   * (L'IA, elle, lit toujours les profils actuels au moment de l'envoi.)
   */
  private async syncProfileSnapshots(user: {
    _id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    language: string;
    gender: string | null;
    profilePicture: string | null;
    isPlaceholder: boolean;
  }): Promise<void> {
    const snapshot = {
      userId: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      language: user.language,
      gender: user.gender,
      profilePicture: user.profilePicture,
      isPlaceholder: user.isPlaceholder,
    };
    await Promise.all([
      this.prisma.humlinker.updateMany({
        where: { targetId: user._id },
        data: { targetSnapshot: snapshot },
      }),
      this.prisma.humlinker.updateMany({
        where: { senderId: user._id },
        data: { senderSnapshot: snapshot },
      }),
    ]);
  }

  async updateEmail(userId: string, dto: UpdateEmailDto): Promise<SafeUser> {
    await this.findUserOrThrow(userId);
    const newEmail = dto.newEmail.toLowerCase();
    await this.otpService.checkSingleVerifiedAndClear(newEmail, 'email');
    const existing = await this.usersRepository.findByEmail(newEmail);
    if (existing && existing._id !== userId) {
      throw new ConflictException('Cet email est déjà utilisé.');
    }
    const updated = await this.usersRepository.update(userId, {
      email: newEmail,
      isEmailVerified: true,
    });
    if (!updated) throw new NotFoundException('Utilisateur introuvable.');
    return sanitizeUser(updated);
  }

  async updatePhone(userId: string, dto: UpdatePhoneDto): Promise<SafeUser> {
    await this.findUserOrThrow(userId);
    await this.otpService.checkSingleVerifiedAndClear(
      dto.newPhoneNumber,
      'phone',
    );
    const existing = await this.usersRepository.findByPhoneNumber(
      dto.newPhoneNumber,
    );
    if (existing && existing._id !== userId) {
      throw new ConflictException('Ce numéro de téléphone est déjà utilisé.');
    }
    const updated = await this.usersRepository.update(userId, {
      phoneNumber: dto.newPhoneNumber,
      isPhoneVerified: true,
    });
    if (!updated) throw new NotFoundException('Utilisateur introuvable.');
    return sanitizeUser(updated);
  }

  /**
   * Change le mot de passe puis ferme toutes les AUTRES sessions. La session
   * courante est conservée : un nouveau jeton d'accès (nouvelle version) est
   * renvoyé — et un nouveau jeton de rafraîchissement si l'appel venait d'un
   * ancien jeton sans session.
   */
  async updatePassword(
    userId: string,
    dto: UpdatePasswordDto,
    currentSid?: string,
  ): Promise<{ token: string; refreshToken?: string }> {
    const user = await this.findUserOrThrow(userId);
    if (!user.passwordHash) {
      throw new BadRequestException(
        'Ce compte utilise Google. Aucun mot de passe à modifier.',
      );
    }
    const matches = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!matches)
      throw new UnauthorizedException('Mot de passe actuel incorrect.');
    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    const updated = await this.usersRepository.update(userId, { passwordHash });
    if (!updated) throw new NotFoundException('Utilisateur introuvable.');

    const keepSid =
      currentSid && (await this.sessions.isSessionActive(currentSid))
        ? currentSid
        : null;
    const tokenVersion = await this.sessions.revokeAll(userId, { exceptSid: keepSid });
    const sessionUser = { _id: updated._id, role: updated.role, tokenVersion };
    if (keepSid) {
      return { token: this.sessions.signAccessToken(sessionUser, keepSid) };
    }
    return this.sessions.createSession(sessionUser);
  }

  async updateFcmToken(userId: string, fcmToken: string): Promise<void> {
    await this.usersRepository.update(userId, { fcmToken });
  }

  /** Recherche par PIN exact (insensible à la casse). Retourne au plus 1 résultat. */
  async searchUsers(
    callerId: string,
    dto: SearchUsersQueryDto,
  ): Promise<PublicUser[]> {
    const pin = dto.q.trim().toUpperCase();
    const user = await this.usersRepository.findByPin(pin);
    if (!user || user._id === callerId || user.isPlaceholder) return [];
    return [toPublicUser(user)];
  }

  async createPlaceholderUser(
    input: CreatePlaceholderUserInput,
  ): Promise<SafeUser> {
    if (input.email) {
      const existing = await this.usersRepository.findByEmail(input.email);
      if (existing) throw new ConflictException('Cet email est déjà utilisé.');
    }
    if (input.phoneNumber) {
      const existing = await this.usersRepository.findByPhoneNumber(
        input.phoneNumber,
      );
      if (existing)
        throw new ConflictException('Ce numéro de téléphone est déjà utilisé.');
    }

    const data: CreateUserData = {
      pin: input.pin,
      language: input.language,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      email: input.email ?? null,
      phoneNumber: input.phoneNumber ?? null,
      gender: input.gender ?? null,
      passwordHash: null,
      authProviders: [],
      isPlaceholder: true,
      placeholderSource: input.placeholderSource ?? null,
    };

    const user = await this.usersRepository.create(data);
    return sanitizeUser(user);
  }

  async upgradePlaceholderUser(
    placeholderUser: User,
    input: UpgradePlaceholderUserInput,
  ): Promise<SafeUser> {
    if (!placeholderUser.isPlaceholder) {
      throw new BadRequestException(
        "Cet utilisateur n'est pas un placeholder.",
      );
    }
    if (input.email) {
      const existing = await this.usersRepository.findByEmail(input.email);
      if (existing && existing._id !== placeholderUser._id) {
        throw new ConflictException('Cet email est déjà utilisé.');
      }
    }
    if (input.phoneNumber) {
      const existing = await this.usersRepository.findByPhoneNumber(
        input.phoneNumber,
      );
      if (existing && existing._id !== placeholderUser._id) {
        throw new ConflictException('Ce numéro de téléphone est déjà utilisé.');
      }
    }

    const passwordHash = input.password
      ? await bcrypt.hash(input.password, BCRYPT_ROUNDS)
      : placeholderUser.passwordHash;

    const updated = await this.usersRepository.update(placeholderUser._id, {
      email: input.email ?? placeholderUser.email,
      phoneNumber: input.phoneNumber ?? placeholderUser.phoneNumber,
      firstName: input.firstName ?? placeholderUser.firstName,
      lastName: input.lastName ?? placeholderUser.lastName,
      gender: input.gender ?? placeholderUser.gender,
      language: input.language ?? placeholderUser.language,
      profilePicture: input.profilePicture ?? placeholderUser.profilePicture,
      passwordHash,
      isPlaceholder: false,
      placeholderSource: null,
      authProviders: placeholderUser.authProviders.length
        ? placeholderUser.authProviders
        : ['local'],
    });

    if (!updated) throw new NotFoundException('Utilisateur introuvable.');

    this.eventEmitter.emit(
      USER_PLACEHOLDER_UPGRADED,
      new UserPlaceholderUpgradedEvent(
        updated._id,
        updated.firstName,
        updated.lastName,
        updated.email,
        updated.phoneNumber,
        updated.language,
        updated.gender,
        updated.profilePicture,
      ),
    );

    return sanitizeUser(updated);
  }

  private async findUserOrThrow(id: string): Promise<User> {
    const user = await this.usersRepository.findById(id);
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    return user;
  }
}
