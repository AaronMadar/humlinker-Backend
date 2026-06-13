import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import type { ApiResponse as AppApiResponse } from '@/common';
import { Public } from '@/decorators';
import { CurrentUser } from '@/decorators/current-user.decorator';
import type { AuthenticatedUser } from './interfaces/jwt-payload.interface';
import type { SafeUser } from '@/utils';
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

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ─── OTP ──────────────────────────────────────────────────────────────────

  @Public()
  @Post('send-otp/email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Envoyer un OTP par email',
    description: "Étape 1 du flow d'inscription ou de reset. Envoie un code à 6 chiffres à l'email fourni (valable 5 min).",
  })
  @ApiBody({ type: SendOtpEmailDto })
  @ApiResponse({ status: 200, description: 'OTP envoyé avec succès.' })
  @ApiResponse({ status: 400, description: 'Email invalide.' })
  async sendOtpEmail(@Body() dto: SendOtpEmailDto): Promise<AppApiResponse<null>> {
    await this.authService.sendEmailOtp(dto.email);
    return { success: true, data: null, message: 'Code OTP envoyé par email.', timestamp: new Date().toISOString() };
  }



  @Public()
  @Post('send-otp/phone')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Envoyer un OTP par SMS',
    description: 'Envoie un code à 6 chiffres au numéro de téléphone fourni via Twilio (valable 5 min).',
  })
  @ApiBody({ type: SendOtpPhoneDto })
  @ApiResponse({ status: 200, description: 'OTP envoyé avec succès.' })
  async sendOtpPhone(@Body() dto: SendOtpPhoneDto): Promise<AppApiResponse<null>> {
    await this.authService.sendPhoneOtp(dto.phoneNumber);
    return { success: true, data: null, message: 'Code OTP envoyé par SMS.', timestamp: new Date().toISOString() };
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Vérifier un code OTP',
    description:
      "Étapes 2 et 4 du flow. Valide le code reçu par email ou SMS. En cas de succès, pose un flag Redis 'verified' valable 15 min — nécessaire avant /register ou /reset-password.",
  })
  @ApiBody({ type: VerifyOtpDto })
  @ApiResponse({ status: 200, description: 'OTP vérifié — flag Redis posé.' })
  @ApiResponse({ status: 400, description: 'Code expiré, invalide ou incorrect.' })
  async verifyOtp(@Body() dto: VerifyOtpDto): Promise<AppApiResponse<null>> {
    await this.authService.verifyOtp(dto.target, dto.code, dto.type);
    return {
      success: true,
      data: null,
      message: `${dto.type === 'email' ? 'Email' : 'Téléphone'} vérifié avec succès.`,
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Inscription ──────────────────────────────────────────────────────────

  @Public()
  @Post('register')
  @ApiOperation({
    summary: "Inscription classique",
    description:
      "Étape 5 du flow. Crée le compte utilisateur. **Pré-requis :** email ET téléphone doivent être vérifiés via OTP (flags Redis valables 15 min). Retourne le JWT + profil utilisateur.",
  })
  @ApiBody({ type: RegisterUserDto })
  @ApiResponse({ status: 201, description: 'Compte créé — JWT retourné.' })
  @ApiResponse({ status: 400, description: 'Email ou téléphone non vérifiés via OTP.' })
  @ApiResponse({ status: 409, description: 'Email ou téléphone déjà utilisé.' })
  async register(@Body() dto: RegisterUserDto): Promise<AppApiResponse<AuthResponseData>> {
    const result = await this.authService.register(dto);
    return { success: true, data: result, timestamp: new Date().toISOString() };
  }

  // ─── Connexion ────────────────────────────────────────────────────────────

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Connexion',
    description: "Authentifie l'utilisateur avec email **ou** numéro de téléphone + mot de passe. Retourne le JWT + profil.",
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'Connexion réussie — JWT retourné.' })
  @ApiResponse({ status: 401, description: 'Identifiant ou mot de passe incorrect.' })
  @ApiResponse({ status: 404, description: 'Aucun compte trouvé avec cet identifiant.' })
  async login(@Body() dto: LoginDto): Promise<AppApiResponse<AuthResponseData>> {
    const result = await this.authService.login(dto);
    return { success: true, data: result, timestamp: new Date().toISOString() };
  }

  // ─── Google Auth ──────────────────────────────────────────────────────────

  @Public()
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Connexion via Google OAuth',
    description:
      "Authentifie l'utilisateur avec un `idToken` Google obtenu côté client. Si c'est un nouveau compte, retourne `requiresProfileCompletion: true` — le front doit rediriger vers l'écran de complétion (téléphone + langue).",
  })
  @ApiBody({ type: GoogleAuthDto })
  @ApiResponse({ status: 200, description: 'Auth Google réussie. `requiresProfileCompletion` indique si le profil est à compléter.' })
  @ApiResponse({ status: 401, description: 'idToken Google invalide ou expiré.' })
  async googleAuth(@Body() dto: GoogleAuthDto): Promise<AppApiResponse<AuthResponseData>> {
    const result = await this.authService.googleAuth(dto);
    return { success: true, data: result, timestamp: new Date().toISOString() };
  }

  // ─── Reset password ───────────────────────────────────────────────────────

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Réinitialiser le mot de passe oublié',
    description:
      "Réinitialise le mot de passe. **Pré-requis :** vérifier l'email ou le téléphone via `/send-otp` + `/verify-otp` (flag Redis valable 15 min).",
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({ status: 200, description: 'Mot de passe réinitialisé.' })
  @ApiResponse({ status: 400, description: "Identifiant non vérifié ou flag Redis expiré." })
  @ApiResponse({ status: 404, description: 'Aucun compte trouvé avec cet identifiant.' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<AppApiResponse<null>> {
    await this.authService.resetPassword(dto.identifier, dto.type, dto.newPassword);
    return { success: true, data: null, message: 'Mot de passe réinitialisé avec succès.', timestamp: new Date().toISOString() };
  }

  // ─── Complete Google profile ──────────────────────────────────────────────

  @Post('complete-profile')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Compléter le profil après connexion Google',
    description:
      "Finalise le compte créé via Google (téléphone + langue). **Nécessite** le JWT retourné par `/auth/google`. **Pré-requis :** téléphone vérifié via `/send-otp/phone` + `/verify-otp`.",
  })
  @ApiBody({ type: CompleteGoogleProfileDto })
  @ApiResponse({ status: 201, description: 'Profil complété — JWT définitif retourné.' })
  @ApiResponse({ status: 400, description: 'Téléphone non vérifié via OTP.' })
  @ApiResponse({ status: 401, description: 'JWT manquant ou invalide.' })
  @ApiResponse({ status: 409, description: 'Username ou téléphone déjà utilisé.' })
  async completeGoogleProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CompleteGoogleProfileDto,
  ): Promise<AppApiResponse<AuthResponseData>> {
    const result = await this.authService.completeGoogleProfile(user.userId, dto);
    return { success: true, data: result, timestamp: new Date().toISOString() };
  }
}
