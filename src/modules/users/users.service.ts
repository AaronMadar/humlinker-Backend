/**
 * UsersService
 *
 * Gère les actions liées au profil utilisateur.
 *
 * ─── Routes exposées ───────────────────────────────────────────────────────
 *
 *  GET   /users/me           → getMe()
 *  PATCH /users/me           → updateUserProfile()
 *  PATCH /users/me/email     → updateEmail()
 *  PATCH /users/me/phone     → updatePhone()
 *  PATCH /users/me/password  → updatePassword()
 *
 * ─── Méthodes internes (appelées par d'autres modules) ─────────────────────
 *
 *  getUserById()             → depuis le module humlinker
 *  createPlaceholderUser()   → lors de la création d'un humlinker pour un
 *                              destinataire non encore inscrit
 *  upgradePlaceholderUser()  → quand un placeholder s'inscrit
 *
 * ─── Flows email / téléphone ───────────────────────────────────────────────
 *
 *  Changer l'email :
 *  1. POST /auth/send-otp/email  (avec le nouvel email)
 *  2. POST /auth/verify-otp      → flag Redis verified:email:{newEmail}
 *  3. PATCH /users/me/email      → vérifie le flag → archive l'ancien dans
 *                                  previousEmails[] → met à jour
 *
 *  Changer le téléphone : même flow avec /phone
 *
 * ───────────────────────────────────────────────────────────────────────────
 */
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
import { sanitizeUser, type SafeUser } from '../../utils';
import { UserContactUpdatedEvent, USER_CONTACT_UPDATED } from '../../events';
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

const BCRYPT_ROUNDS = 10;

export interface CreatePlaceholderUserInput {
  language: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
  gender?: User['gender'];
  placeholderSource?: UserPlaceholderSource;
}

export interface UpgradePlaceholderUserInput {
  email?: string | null;
  username?: string | null;
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
  ) {}

  // ─── Lecture ──────────────────────────────────────────────────────────────

  /** Retourne le profil complet de l'utilisateur connecté (sans passwordHash). */
  async getMe(userId: string): Promise<SafeUser> {
    const user = await this.findUserOrThrow(userId);
    return sanitizeUser(user);
  }

  /**
   * Retourne le profil d'un user par son ID.
   * Utilisé dans le contexte d'un Humlinker pour voir le profil du destinataire.
   */
  async getUserById(id: string): Promise<SafeUser> {
    const user = await this.findUserOrThrow(id);
    return sanitizeUser(user);
  }

  // ─── Modification profil ──────────────────────────────────────────────────

  /**
   * Met à jour les infos de base du profil (nom, username, langue, photo, genre).
   * Email et téléphone sont gérés séparément car ils nécessitent une vérification OTP.
   */
  async updateUserProfile(
    userId: string,
    dto: UpdateUserProfileDto,
  ): Promise<SafeUser> {
    await this.findUserOrThrow(userId);

    if (dto.username) {
      const existing = await this.usersRepository.findByUsername(dto.username);
      if (existing && existing._id !== userId) {
        throw new ConflictException("Ce nom d'utilisateur est déjà utilisé.");
      }
    }

    const updated = await this.usersRepository.update(userId, {
      firstName: dto.firstName,
      lastName: dto.lastName,
      username: dto.username,
      language: dto.language,
      profilePicture: dto.profilePicture,
      gender: dto.gender,
    });

    if (!updated) throw new NotFoundException('Utilisateur introuvable.');
    return sanitizeUser(updated);
  }

  // ─── Changement email ─────────────────────────────────────────────────────

  /**
   * Change l'email de l'utilisateur.
   *
   * Pré-requis : le front doit avoir vérifié le nouvel email via OTP.
   * L'ancien email est archivé dans previousEmails[] pour la synchro des contacts.
   */
  async updateEmail(userId: string, dto: UpdateEmailDto): Promise<SafeUser> {
    const user = await this.findUserOrThrow(userId);
    const newEmail = dto.newEmail.toLowerCase();

    // Vérification du flag OTP Redis
    await this.otpService.checkSingleVerifiedAndClear(newEmail, 'email');

    // Vérification doublon
    const existing = await this.usersRepository.findByEmail(newEmail);
    if (existing && existing._id !== userId) {
      throw new ConflictException('Cet email est déjà utilisé.');
    }

    // Archive l'ancien email dans previousEmails[]
    const previousEmails = user.email
      ? [...new Set([...user.previousEmails, user.email.toLowerCase()])]
      : user.previousEmails;

    const updated = await this.usersRepository.update(userId, {
      email: newEmail,
      isEmailVerified: true,
      previousEmails,
    });

    if (!updated) throw new NotFoundException('Utilisateur introuvable.');

    // Déclenche la re-sync des contacts pour ce nouvel email
    this.eventEmitter.emit(
      USER_CONTACT_UPDATED,
      new UserContactUpdatedEvent(
        userId,
        updated.phoneNumber ? [updated.phoneNumber] : [],
        [newEmail],
      ),
    );

    return sanitizeUser(updated);
  }

  // ─── Changement téléphone ─────────────────────────────────────────────────

  /**
   * Change le numéro de téléphone de l'utilisateur.
   *
   * Pré-requis : le front doit avoir vérifié le nouveau numéro via OTP.
   * L'ancien numéro est archivé dans previousPhoneNumbers[] pour la synchro des contacts.
   */
  async updatePhone(userId: string, dto: UpdatePhoneDto): Promise<SafeUser> {
    const user = await this.findUserOrThrow(userId);

    await this.otpService.checkSingleVerifiedAndClear(dto.newPhoneNumber, 'phone');

    const existing = await this.usersRepository.findByPhoneNumber(dto.newPhoneNumber);
    if (existing && existing._id !== userId) {
      throw new ConflictException('Ce numéro de téléphone est déjà utilisé.');
    }

    const previousPhoneNumbers = user.phoneNumber
      ? [...new Set([...user.previousPhoneNumbers, user.phoneNumber])]
      : user.previousPhoneNumbers;

    const updated = await this.usersRepository.update(userId, {
      phoneNumber: dto.newPhoneNumber,
      isPhoneVerified: true,
      previousPhoneNumbers,
    });

    if (!updated) throw new NotFoundException('Utilisateur introuvable.');

    // Déclenche la re-sync des contacts pour ce nouveau numéro
    this.eventEmitter.emit(
      USER_CONTACT_UPDATED,
      new UserContactUpdatedEvent(
        userId,
        [dto.newPhoneNumber],
        updated.email ? [updated.email] : [],
      ),
    );

    return sanitizeUser(updated);
  }

  // ─── Changement mot de passe ──────────────────────────────────────────────

  /**
   * Change le mot de passe de l'utilisateur connecté qui connaît son mot de passe actuel.
   * Pour le reset (mot de passe oublié) → AuthService.resetPassword().
   */
  async updatePassword(userId: string, dto: UpdatePasswordDto): Promise<void> {
    const user = await this.findUserOrThrow(userId);

    if (!user.passwordHash) {
      throw new BadRequestException(
        'Ce compte utilise Google. Aucun mot de passe à modifier.',
      );
    }

    const matches = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Mot de passe actuel incorrect.');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    const updated = await this.usersRepository.update(userId, { passwordHash });
    if (!updated) throw new NotFoundException('Utilisateur introuvable.');
  }

  // ─── FCM Token ────────────────────────────────────────────────────────────

  /**
   * Met à jour le token FCM de l'utilisateur.
   * Appelé à chaque login / ouverture de l'app.
   */
  async updateFcmToken(userId: string, fcmToken: string): Promise<void> {
    await this.usersRepository.update(userId, { fcmToken });
  }

  // ─── Recherche utilisateurs ───────────────────────────────────────────────

  /**
   * Recherche des utilisateurs inscrits (non-placeholder) par username,
   * prénom, nom, email ou téléphone.
   * Exclut l'appelant. Limite par défaut : 10, max : 50.
   */
  async searchUsers(
    callerId: string,
    dto: SearchUsersQueryDto,
  ): Promise<SafeUser[]> {
    const limit = dto.limit ?? 10;
    const users = await this.usersRepository.searchUsers(dto.q, callerId, limit);
    return users.map(sanitizeUser);
  }

  // ─── Placeholder users ────────────────────────────────────────────────────

  /**
   * Crée un utilisateur placeholder.
   * Appelé lors de la création d'un Humlinker quand le destinataire n'est pas encore inscrit.
   */
  async createPlaceholderUser(
    input: CreatePlaceholderUserInput,
  ): Promise<SafeUser> {
    await this.assertNoDuplicates({
      email: input.email ?? undefined,
      phoneNumber: input.phoneNumber ?? undefined,
    });

    const data: CreateUserData = {
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

  /**
   * Transforme un placeholder en vrai utilisateur.
   * Appelé quand un destinataire d'invitation Humlinker crée son compte.
   */
  async upgradePlaceholderUser(
    placeholderUser: User,
    input: UpgradePlaceholderUserInput,
  ): Promise<SafeUser> {
    if (!placeholderUser.isPlaceholder) {
      throw new BadRequestException("Cet utilisateur n'est pas un placeholder.");
    }

    await this.assertNoDuplicates(
      {
        email: input.email ?? undefined,
        username: input.username ?? undefined,
        phoneNumber: input.phoneNumber ?? undefined,
      },
      placeholderUser._id,
    );

    const passwordHash = input.password
      ? await bcrypt.hash(input.password, BCRYPT_ROUNDS)
      : placeholderUser.passwordHash;

    const updated = await this.usersRepository.update(placeholderUser._id, {
      email: input.email ?? placeholderUser.email,
      username: input.username ?? placeholderUser.username,
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

    // Déclenche la re-sync des contacts : ce placeholder devient un vrai utilisateur
    const phones = updated.phoneNumber ? [updated.phoneNumber] : [];
    const emails = updated.email ? [updated.email] : [];
    if (phones.length > 0 || emails.length > 0) {
      this.eventEmitter.emit(
        USER_CONTACT_UPDATED,
        new UserContactUpdatedEvent(updated._id, phones, emails),
      );
    }

    return sanitizeUser(updated);
  }

  // ─── Utilitaires privés ───────────────────────────────────────────────────

  private async findUserOrThrow(id: string): Promise<User> {
    const user = await this.usersRepository.findById(id);
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    return user;
  }

  private async assertNoDuplicates(
    fields: { email?: string; username?: string; phoneNumber?: string },
    excludeUserId?: string,
  ): Promise<void> {
    if (fields.email) {
      const existing = await this.usersRepository.findByEmail(fields.email);
      if (existing && existing._id !== excludeUserId) {
        throw new ConflictException('Cet email est déjà utilisé.');
      }
    }
    if (fields.username) {
      const existing = await this.usersRepository.findByUsername(fields.username);
      if (existing && existing._id !== excludeUserId) {
        throw new ConflictException("Ce nom d'utilisateur est déjà utilisé.");
      }
    }
    if (fields.phoneNumber) {
      const existing = await this.usersRepository.findByPhoneNumber(fields.phoneNumber);
      if (existing && existing._id !== excludeUserId) {
        throw new ConflictException('Ce numéro de téléphone est déjà utilisé.');
      }
    }
  }
}
