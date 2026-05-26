/**
 * AuthController
 *
 * Expose les routes d'authentification de Humlinker.
 * Toutes ces routes sont @Public() sauf POST /auth/complete-profile
 * qui nécessite le JWT retourné par POST /auth/google.
 *
 * ─── Routes ────────────────────────────────────────────────────────────────
 *
 *  [Public] POST /api/v1/auth/send-otp/email    → Envoie un OTP par email
 *  [Public] POST /api/v1/auth/send-otp/phone    → Envoie un OTP par SMS
 *  [Public] POST /api/v1/auth/verify-otp        → Vérifie un code OTP
 *  [Public] POST /api/v1/auth/register          → Inscription classique
 *  [Public] POST /api/v1/auth/login             → Connexion
 *  [Public] POST /api/v1/auth/google            → Auth via Google
 *  [Auth]   POST /api/v1/auth/complete-profile  → Complétion profil Google
 *
 * ───────────────────────────────────────────────────────────────────────────
 */
import { Body, Controller, Post } from '@nestjs/common';
import type { ApiResponse } from '../../common';
import { Public } from '../../decorators';
import { CurrentUser } from '../../decorators/current-user.decorator';
import type { AuthenticatedUser } from './interfaces/jwt-payload.interface';
import type { SafeUser } from '../../utils';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterUserDto } from './dto/register-user.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { SendOtpEmailDto, SendOtpPhoneDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { CompleteGoogleProfileDto } from './dto/complete-google-profile.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

interface AuthResponseData {
  user: SafeUser;
  token: string;
  requiresProfileCompletion?: boolean;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ─── OTP ──────────────────────────────────────────────────────────────────

  /**
   * Envoie un OTP par email.
   * Étape 1 du flow inscription — appelé pendant le remplissage du formulaire.
   */
  @Public()
  @Post('send-otp/email')
  async sendOtpEmail(
    @Body() dto: SendOtpEmailDto,
  ): Promise<ApiResponse<null>> {
    await this.authService.sendEmailOtp(dto.email);
    return {
      success: true,
      data: null,
      message: 'Code OTP envoyé par email.',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Envoie un OTP par SMS.
   * Étape 3 du flow inscription — appelé pendant le remplissage du formulaire.
   */
  @Public()
  @Post('send-otp/phone')
  async sendOtpPhone(
    @Body() dto: SendOtpPhoneDto,
  ): Promise<ApiResponse<null>> {
    await this.authService.sendPhoneOtp(dto.phoneNumber);
    return {
      success: true,
      data: null,
      message: 'Code OTP envoyé par SMS.',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Vérifie un code OTP (email ou téléphone).
   * Étapes 2 et 4 du flow inscription.
   * En cas de succès, pose le flag "verified" dans Redis (TTL 15min).
   */
  @Public()
  @Post('verify-otp')
  async verifyOtp(@Body() dto: VerifyOtpDto): Promise<ApiResponse<null>> {
    await this.authService.verifyOtp(dto.target, dto.code, dto.type);
    return {
      success: true,
      data: null,
      message: `${dto.type === 'email' ? 'Email' : 'Téléphone'} vérifié avec succès.`,
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Inscription ──────────────────────────────────────────────────────────

  /**
   * Inscription classique.
   * Étape 5 du flow — appelé après vérification email + téléphone via OTP.
   * Le backend vérifie les flags Redis avant de créer le user en DB.
   */
  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterUserDto,
  ): Promise<ApiResponse<AuthResponseData>> {
    const result = await this.authService.register(dto);
    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Connexion ────────────────────────────────────────────────────────────

  /**
   * Connexion avec email OU username OU numéro de téléphone + mot de passe.
   */
  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto): Promise<ApiResponse<AuthResponseData>> {
    const result = await this.authService.login(dto);
    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Google Auth ──────────────────────────────────────────────────────────

  /**
   * Authentification via Google OAuth.
   * Le front envoie le idToken obtenu côté client via la librairie Google.
   *
   * Réponse :
   *  - requiresProfileCompletion: false → accès complet (user existant)
   *  - requiresProfileCompletion: true  → le front redirige vers l'écran
   *    de complétion (username + téléphone + langue)
   */
  @Public()
  @Post('google')
  async googleAuth(
    @Body() dto: GoogleAuthDto,
  ): Promise<ApiResponse<AuthResponseData>> {
    const result = await this.authService.googleAuth(dto);
    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Réinitialise le mot de passe oublié.
   * Pré-requis : OTP email ou téléphone vérifié via send-otp + verify-otp.
   */
  @Public()
  @Post('reset-password')
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<ApiResponse<null>> {
    await this.authService.resetPassword(
      dto.identifier,
      dto.type,
      dto.newPassword,
    );
    return {
      success: true,
      data: null,
      message: 'Mot de passe réinitialisé avec succès.',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Complétion du profil après inscription Google.
   * Nécessite le JWT retourné par POST /auth/google.
   * Le front doit avoir vérifié le téléphone via OTP avant cet appel.
   */
  @Post('complete-profile')
  async completeGoogleProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CompleteGoogleProfileDto,
  ): Promise<ApiResponse<AuthResponseData>> {
    const result = await this.authService.completeGoogleProfile(
      user.userId,
      dto,
    );
    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    };
  }
}
