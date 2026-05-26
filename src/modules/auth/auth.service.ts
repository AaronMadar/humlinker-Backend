/**
 * AuthService
 *
 * Gère toute la logique d'authentification de Humlinker.
 *
 * ─── Routes disponibles ────────────────────────────────────────────────────
 *
 *  POST /auth/send-otp/email    → sendEmailOtp()
 *  POST /auth/send-otp/phone    → sendPhoneOtp()
 *  POST /auth/verify-otp        → verifyOtp()
 *  POST /auth/register          → register()
 *  POST /auth/login             → login()
 *  POST /auth/google            → googleAuth()
 *  POST /auth/complete-profile  → completeGoogleProfile()
 *
 * ─── Flow inscription classique ────────────────────────────────────────────
 *  1. sendEmailOtp()  → OTP envoyé par email, stocké Redis 5min
 *  2. verifyOtp()     → code vérifié → flag "verified:email" Redis 15min
 *  3. sendPhoneOtp()  → OTP envoyé par SMS, stocké Redis 5min
 *  4. verifyOtp()     → code vérifié → flag "verified:phone" Redis 15min
 *  5. register()      → vérifie les 2 flags Redis → crée user en DB → JWT
 *
 * ─── Flow connexion ────────────────────────────────────────────────────────
 *  1. login() avec email OU username OU téléphone + mot de passe
 *
 * ─── Flow Google ───────────────────────────────────────────────────────────
 *  1. googleAuth() → vérifie idToken → cherche user par email
 *     → si existant : lie les comptes → JWT (accès complet)
 *     → si nouveau : crée user → JWT + requiresProfileCompletion: true
 *  2. (si nouveau) sendPhoneOtp() → verifyOtp()
 *  3. completeGoogleProfile() → vérifie flag "verified:phone" → complète profil
 *
 * ───────────────────────────────────────────────────────────────────────────
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OAuth2Client } from 'google-auth-library';
import * as bcrypt from 'bcrypt';
import { sanitizeUser, type SafeUser } from '../../utils';
import { UserContactUpdatedEvent, USER_CONTACT_UPDATED } from '../../events';
import { APP_CONFIG } from '../../config';
import configuration from '../../config/configuration';
import { USERS_REPOSITORY, type UsersRepository } from '../users/repositories';
import { OtpService } from './services/otp.service';
import type { RegisterUserDto } from './dto/register-user.dto';
import type { LoginDto } from './dto/login.dto';
import type { GoogleAuthDto } from './dto/google-auth.dto';
import type { CompleteGoogleProfileDto } from './dto/complete-google-profile.dto';
import type { JwtPayload } from './interfaces/jwt-payload.interface';

const BCRYPT_ROUNDS = 10;

export interface AuthResult {
  user: SafeUser;
  token: string;
  /** Présent uniquement dans le flow Google pour les nouveaux utilisateurs */
  requiresProfileCompletion?: boolean;
}

@Injectable()
export class AuthService {
  private readonly googleClient: OAuth2Client;

  constructor(
    @Inject(USERS_REPOSITORY)
    private readonly usersRepository: UsersRepository,
    @Inject(APP_CONFIG)
    private readonly config: ReturnType<typeof configuration>,
    private readonly jwtService: JwtService,
    private readonly otpService: OtpService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    // Initialisation du client Google OAuth avec le clientId de la config
    this.googleClient = new OAuth2Client(config.google.clientId);
  }

  // ─── OTP ──────────────────────────────────────────────────────────────────

  /**
   * Délègue l'envoi de l'OTP email à OtpService.
   * Appelé sur POST /auth/send-otp/email.
   */
  async sendEmailOtp(email: string): Promise<void> {
    await this.otpService.sendEmailOtp(email);
  }

  /**
   * Délègue l'envoi de l'OTP SMS à OtpService.
   * Appelé sur POST /auth/send-otp/phone.
   */
  async sendPhoneOtp(phoneNumber: string): Promise<void> {
    await this.otpService.sendPhoneOtp(phoneNumber);
  }

  /**
   * Délègue la vérification de l'OTP à OtpService.
   * Appelé sur POST /auth/verify-otp.
   * En cas de succès, OtpService pose le flag "verified" dans Redis.
   */
  async verifyOtp(
    target: string,
    code: string,
    type: 'email' | 'phone',
  ): Promise<void> {
    await this.otpService.verifyOtp(target, code, type);
  }

  // ─── Inscription ──────────────────────────────────────────────────────────

  /**
   * Inscription classique (email + téléphone + mot de passe).
   *
   * Étapes :
   * 1. Vérifie que les flags Redis "verified:email" et "verified:phone" existent
   *    → Protège contre les appels directs API sans passer par le flow OTP
   * 2. Vérifie qu'il n'y a pas de doublons en DB (email, username, phoneNumber)
   * 3. Hash le mot de passe
   * 4. Crée le user en DB avec isEmailVerified: true et isPhoneVerified: true
   * 5. Nettoie les flags Redis
   * 6. Retourne un JWT + SafeUser
   */
  async register(dto: RegisterUserDto): Promise<AuthResult> {
    // Étape 1 — Vérification des flags Redis (protection anti-bypass API)
    await this.otpService.checkBothVerifiedAndClear(dto.email, dto.phoneNumber);

    // Étape 2 — Vérification des doublons en DB
    await this.assertNoDuplicates({
      email: dto.email,
      username: dto.username,
      phoneNumber: dto.phoneNumber,
    });

    // Étape 3 — Hash du mot de passe
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    // Étape 4 — Création du user en DB
    const user = await this.usersRepository.create({
      email: dto.email,
      username: dto.username,
      phoneNumber: dto.phoneNumber,
      firstName: dto.firstName ?? null,
      lastName: dto.lastName ?? null,
      gender: dto.gender ?? null,
      language: dto.language,
      passwordHash,
      authProviders: ['local'],
      isEmailVerified: true,  // Vérifié via OTP avant l'appel à register
      isPhoneVerified: true,  // Vérifié via OTP avant l'appel à register
      isPlaceholder: false,
      placeholderSource: null,
      role: 'user',
    });

    const token = this.generateToken(user._id, user.role);

    // Déclenche la re-sync des contacts : ce nouvel utilisateur peut être dans
    // le carnet de contacts d'autres utilisateurs (email + téléphone vérifiés)
    this.eventEmitter.emit(
      USER_CONTACT_UPDATED,
      new UserContactUpdatedEvent(
        user._id,
        user.phoneNumber ? [user.phoneNumber] : [],
        user.email ? [user.email] : [],
      ),
    );

    return { user: sanitizeUser(user), token };
  }

  // ─── Connexion ────────────────────────────────────────────────────────────

  /**
   * Connexion avec email OU username OU numéro de téléphone + mot de passe.
   *
   * Étapes :
   * 1. Cherche le user par email, username ou téléphone
   * 2. Si user trouvé mais pas de passwordHash → compte Google → message explicite
   * 3. Compare le mot de passe avec le hash
   * 4. Update lastLoginAt
   * 5. Retourne un JWT + SafeUser
   */
  async login(dto: LoginDto): Promise<AuthResult> {
    // Étape 1 — Recherche du user (email OU username OU téléphone)
    const user = await this.usersRepository.findByEmailOrUsernameOrPhone(
      dto.identifier.trim(),
    );

    if (!user) {
      throw new UnauthorizedException('Identifiants invalides.');
    }

    // Étape 2 — Compte Google sans mot de passe → message explicite
    if (!user.passwordHash) {
      throw new UnauthorizedException(
        'Ce compte utilise Google. Veuillez vous connecter via Google.',
      );
    }

    // Étape 3 — Vérification du mot de passe
    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Identifiants invalides.');
    }

    // Étape 4 — Mise à jour de lastLoginAt
    const updatedUser =
      (await this.usersRepository.updateLastLoginAt(user._id, new Date())) ??
      user;

    const token = this.generateToken(updatedUser._id, updatedUser.role);

    return { user: sanitizeUser(updatedUser), token };
  }

  // ─── Google Auth ──────────────────────────────────────────────────────────

  /**
   * Authentification via Google OAuth.
   *
   * Étapes :
   * 1. Vérifie le idToken auprès de Google → extrait firstName, lastName, email
   * 2. Cherche un user avec cet email en DB
   *    → Si trouvé : lie le compte Google (ajoute 'google' aux authProviders si absent)
   *      → Update lastLoginAt → Retourne JWT + SafeUser (accès complet)
   *    → Si non trouvé : crée un nouveau user avec les infos Google
   *      → Retourne JWT + requiresProfileCompletion: true
   *        (le front redirige vers l'écran de complétion : username + téléphone)
   */
  async googleAuth(dto: GoogleAuthDto): Promise<AuthResult> {
    // Étape 1 — Vérification du token Google
    const googlePayload = await this.verifyGoogleToken(dto.idToken);
    const { email, firstName, lastName } = googlePayload;

    // Étape 2 — Recherche du user par email
    const existingUser = await this.usersRepository.findByEmail(email);

    if (existingUser) {
      // ─── User existant : on lie le compte Google si pas déjà fait
      const providers = existingUser.authProviders;
      if (!providers.includes('google')) {
        await this.usersRepository.update(existingUser._id, {
          authProviders: [...providers, 'google'],
        });
      }

      const updatedUser =
        (await this.usersRepository.updateLastLoginAt(
          existingUser._id,
          new Date(),
        )) ?? existingUser;

      const token = this.generateToken(updatedUser._id, updatedUser.role);
      return { user: sanitizeUser(updatedUser), token };
    }

    // ─── Nouveau user Google : username et téléphone manquants
    const newUser = await this.usersRepository.create({
      email,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      language: 'fr', // langue par défaut, mise à jour lors de la complétion du profil
      authProviders: ['google'],
      isEmailVerified: true, // Google a déjà vérifié l'email
      isPhoneVerified: false,
      isPlaceholder: false,
      placeholderSource: null,
      role: 'user',
    });

    const token = this.generateToken(newUser._id, newUser.role);

    return {
      user: sanitizeUser(newUser),
      token,
      requiresProfileCompletion: true, // Le front redirige vers l'écran de complétion
    };
  }

  /**
   * Complétion du profil après inscription Google.
   *
   * Appelé uniquement si requiresProfileCompletion: true dans googleAuth().
   *
   * Étapes :
   * 1. Vérifie que le flag Redis "verified:phone" existe pour le numéro fourni
   *    → Le front doit avoir fait passer le téléphone par le flow OTP
   * 2. Vérifie qu'il n'y a pas de doublons (username, phoneNumber)
   * 3. Met à jour le profil du user en DB
   * 4. Retourne JWT + SafeUser (accès complet)
   */
  async completeGoogleProfile(
    userId: string,
    dto: CompleteGoogleProfileDto,
  ): Promise<AuthResult> {
    // Étape 1 — Vérification du flag Redis "verified:phone"
    await this.otpService.checkPhoneVerifiedAndClear(dto.phoneNumber);

    // Étape 2 — Vérification des doublons
    await this.assertNoDuplicates(
      { username: dto.username, phoneNumber: dto.phoneNumber },
      userId,
    );

    // Étape 3 — Mise à jour du profil
    const updated = await this.usersRepository.update(userId, {
      username: dto.username,
      phoneNumber: dto.phoneNumber,
      language: dto.language,
      isPhoneVerified: true,
    });

    if (!updated) {
      throw new BadRequestException('Utilisateur introuvable.');
    }

    // Déclenche la re-sync des contacts : l'utilisateur Google vient de compléter son profil
    // avec un numéro de téléphone vérifié → il peut être dans les contacts d'autres utilisateurs
    this.eventEmitter.emit(
      USER_CONTACT_UPDATED,
      new UserContactUpdatedEvent(
        updated._id,
        updated.phoneNumber ? [updated.phoneNumber] : [],
        updated.email ? [updated.email] : [],
      ),
    );

    const token = this.generateToken(updated._id, updated.role);
    return { user: sanitizeUser(updated), token };
  }

  // ─── Reset mot de passe ───────────────────────────────────────────────────

  /**
   * Réinitialise le mot de passe oublié via OTP.
   *
   * Étapes :
   * 1. Le front a appelé POST /auth/send-otp/email ou /phone avec l'identifiant
   * 2. L'utilisateur a vérifié le code → flag Redis verified:email ou verified:phone
   * 3. Ici : vérifie le flag → cherche le user → hash + update du mot de passe
   *
   * - identifier : email ou numéro de téléphone utilisé pour le reset
   * - type       : 'email' ou 'phone'
   * - newPassword : nouveau mot de passe
   */
  async resetPassword(
    identifier: string,
    type: 'email' | 'phone',
    newPassword: string,
  ): Promise<void> {
    // Vérification du flag OTP Redis
    await this.otpService.checkSingleVerifiedAndClear(identifier, type);

    // Recherche du user par email ou téléphone
    const user =
      type === 'email'
        ? await this.usersRepository.findByEmail(identifier)
        : await this.usersRepository.findByPhoneNumber(identifier);

    if (!user) {
      throw new UnauthorizedException('Aucun compte trouvé avec cet identifiant.');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.usersRepository.update(user._id, { passwordHash });
  }

  // ─── Utilitaires ──────────────────────────────────────────────────────────

  /**
   * Génère un JWT signé avec userId et role.
   * Expiré selon JWT_EXPIRATION dans la config.
   */
  generateToken(userId: string, role: 'user' | 'admin'): string {
    const payload: JwtPayload = { userId, role };
    return this.jwtService.sign(payload);
  }

  /**
   * Vérifie le idToken Google via l'API Google et retourne les infos du user.
   * Lance une UnauthorizedException si le token est invalide ou expiré.
   */
  private async verifyGoogleToken(idToken: string): Promise<{
    email: string;
    firstName?: string;
    lastName?: string;
  }> {
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: this.config.google.clientId,
      });
      const payload = ticket.getPayload();

      if (!payload?.email) {
        throw new UnauthorizedException(
          'Token Google invalide : email manquant.',
        );
      }

      return {
        email: payload.email,
        firstName: payload.given_name,
        lastName: payload.family_name,
      };
    } catch {
      throw new UnauthorizedException('Token Google invalide ou expiré.');
    }
  }

  /**
   * Vérifie qu'aucun user existant n'utilise déjà les champs fournis.
   * excludeUserId : exclut un user précis de la vérification (utile pour les updates).
   */
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
      const existing = await this.usersRepository.findByUsername(
        fields.username,
      );
      if (existing && existing._id !== excludeUserId) {
        throw new ConflictException("Ce nom d'utilisateur est déjà utilisé.");
      }
    }

    if (fields.phoneNumber) {
      const existing = await this.usersRepository.findByPhoneNumber(
        fields.phoneNumber,
      );
      if (existing && existing._id !== excludeUserId) {
        throw new ConflictException('Ce numéro de téléphone est déjà utilisé.');
      }
    }
  }
}
