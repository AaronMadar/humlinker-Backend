/**
 * AuthService
 *
 * ─── Flow Google ───────────────────────────────────────────────────────────────
 *  1. googleAuth() → vérifie idToken → cherche user par email
 *     → si existant & profil complet : JWT (accès complet)
 *     → si nouveau ou profil incomplet : JWT + requiresProfileCompletion: true
 *  2. completeGoogleProfile() → vérifie téléphone OTP → complète profil
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { sanitizeUser, type SafeUser } from '@/utils';
import { APP_CONFIG } from '@/config';
import configuration from '@/config/configuration';
import { USERS_REPOSITORY, type UsersRepository } from '../users/repositories';
import { OtpService } from './services/otp.service';
import type { RegisterUserDto } from './dto/register-user.dto';
import type { LoginDto } from './dto/login.dto';
import type { GoogleAuthDto } from './dto/google-auth.dto';
import type { CompleteGoogleProfileDto } from './dto/complete-google-profile.dto';
import type { JwtPayload } from './interfaces/jwt-payload.interface';

const BCRYPT_ROUNDS = 10;
const PIN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O et 1/I pour éviter la confusion

export interface AuthResult {
  user: SafeUser;
  token: string;
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
  ) {
    this.googleClient = new OAuth2Client(config.google.clientId);
  }

  // ─── OTP ──────────────────────────────────────────────────────────────────

  async sendEmailOtp(email: string): Promise<void> {
    await this.otpService.sendEmailOtp(email);
  }

  async sendPhoneOtp(phoneNumber: string): Promise<void> {
    await this.otpService.sendPhoneOtp(phoneNumber);
  }

  async verifyOtp(target: string, code: string, type: 'email' | 'phone'): Promise<void> {
    await this.otpService.verifyOtp(target, code, type);
  }

  // ─── Inscription ──────────────────────────────────────────────────────────

  async register(dto: RegisterUserDto): Promise<AuthResult> {
    await this.otpService.checkBothVerifiedAndClear(dto.email, dto.phoneNumber);

    await this.assertNoDuplicates({
      email: dto.email,
      phoneNumber: dto.phoneNumber,
    });

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const pin = await this.generateUniquePin();

    const user = await this.usersRepository.create({
      pin,
      email: dto.email,
      phoneNumber: dto.phoneNumber,
      firstName: dto.firstName ?? null,
      lastName: dto.lastName ?? null,
      gender: dto.gender ?? null,
      language: dto.language,
      passwordHash,
      authProviders: ['local'],
      isEmailVerified: true,
      isPhoneVerified: true,
      isPlaceholder: false,
      placeholderSource: null,
      role: 'user',
    });

    const token = this.generateToken(user._id, user.role);
    return { user: sanitizeUser(user), token };
  }

  // ─── Connexion ────────────────────────────────────────────────────────────

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.usersRepository.findByEmailOrPhone(dto.identifier.trim());

    if (!user) {
      throw new UnauthorizedException('Identifiants invalides.');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException(
        'Ce compte utilise Google. Veuillez vous connecter via Google.',
      );
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Identifiants invalides.');
    }

    const updatedUser =
      (await this.usersRepository.updateLastLoginAt(user._id, new Date())) ?? user;

    const token = this.generateToken(updatedUser._id, updatedUser.role);
    return { user: sanitizeUser(updatedUser), token };
  }

  // ─── Google Auth ──────────────────────────────────────────────────────────

  async googleAuth(dto: GoogleAuthDto): Promise<AuthResult> {
    const googlePayload = await this.verifyGoogleToken(dto.idToken);
    const { email, firstName, lastName } = googlePayload;

    const existingUser = await this.usersRepository.findByEmail(email);

    if (existingUser) {
      const providers = existingUser.authProviders;
      if (!providers.includes('google')) {
        await this.usersRepository.update(existingUser._id, {
          authProviders: [...providers, 'google'],
        });
      }

      const updatedUser =
        (await this.usersRepository.updateLastLoginAt(existingUser._id, new Date())) ??
        existingUser;

      const token = this.generateToken(updatedUser._id, updatedUser.role);
      const profileIncomplete = !updatedUser.phoneNumber;
      return {
        user: sanitizeUser(updatedUser),
        token,
        ...(profileIncomplete && { requiresProfileCompletion: true }),
      };
    }

    const pin = await this.generateUniquePin();
    const newUser = await this.usersRepository.create({
      pin,
      email,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      language: 'fr',
      authProviders: ['google'],
      isEmailVerified: true,
      isPhoneVerified: false,
      isPlaceholder: false,
      placeholderSource: null,
      role: 'user',
    });

    const token = this.generateToken(newUser._id, newUser.role);
    return { user: sanitizeUser(newUser), token, requiresProfileCompletion: true };
  }

  // ─── Reset password ───────────────────────────────────────────────────────

  async resetPassword(identifier: string, type: 'email' | 'phone', newPassword: string): Promise<void> {
    await this.otpService.checkSingleVerifiedAndClear(identifier, type);

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

  // ─── Complete Google profile ──────────────────────────────────────────────

  async completeGoogleProfile(userId: string, dto: CompleteGoogleProfileDto): Promise<AuthResult> {
    await this.otpService.checkPhoneVerifiedAndClear(dto.phoneNumber);

    await this.assertNoDuplicates({ phoneNumber: dto.phoneNumber }, userId);

    const updated = await this.usersRepository.update(userId, {
      phoneNumber: dto.phoneNumber,
      language: dto.language,
      isPhoneVerified: true,
    });

    if (!updated) {
      throw new BadRequestException('Utilisateur introuvable.');
    }

    const token = this.generateToken(updated._id, updated.role);
    return { user: sanitizeUser(updated), token };
  }

  // ─── Utilitaires ──────────────────────────────────────────────────────────

  generateToken(userId: string, role: 'user' | 'admin'): string {
    const payload: JwtPayload = { userId, role };
    return this.jwtService.sign(payload);
  }

  /** Génère un PIN unique de 8 caractères (réessaie si collision). */
  private async generateUniquePin(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const bytes = randomBytes(8);
      const pin = Array.from(bytes)
        .map(b => PIN_CHARS[b % PIN_CHARS.length])
        .join('');
      const existing = await this.usersRepository.findByPin(pin);
      if (!existing) return pin;
    }
    throw new Error('Impossible de générer un PIN unique après 10 tentatives.');
  }

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
        throw new UnauthorizedException('Token Google invalide : email manquant.');
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

  private async assertNoDuplicates(
    fields: { email?: string; phoneNumber?: string },
    excludeUserId?: string,
  ): Promise<void> {
    if (fields.email) {
      const existing = await this.usersRepository.findByEmail(fields.email);
      if (existing && existing._id !== excludeUserId) {
        throw new ConflictException('Cet email est déjà utilisé.');
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
