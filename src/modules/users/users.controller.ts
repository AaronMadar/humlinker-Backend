/**
 * UsersController
 *
 * Expose les routes de gestion du profil utilisateur.
 * Toutes ces routes nécessitent un JWT valide (pas de @Public()).
 *
 * ─── Routes ────────────────────────────────────────────────────────────────
 *
 *  GET   /api/v1/users/me           → Récupérer son profil
 *  PATCH /api/v1/users/me           → Modifier son profil (nom, username, langue...)
 *  PATCH /api/v1/users/me/email     → Changer son email (après OTP)
 *  PATCH /api/v1/users/me/phone     → Changer son téléphone (après OTP)
 *  PATCH /api/v1/users/me/password  → Changer son mot de passe
 *
 * ───────────────────────────────────────────────────────────────────────────
 */
import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import type { ApiResponse } from '../../common';
import { CurrentUser } from '../../decorators';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import type { SafeUser } from '../../utils';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UpdateEmailDto } from './dto/update-email.dto';
import { UpdatePhoneDto } from './dto/update-phone.dto';
import { UpdateFcmTokenDto } from './dto/update-fcm-token.dto';
import { SearchUsersQueryDto } from './dto/search-users-query.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Récupère le profil complet de l'utilisateur connecté. */
  @Get('me')
  async getMe(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiResponse<SafeUser>> {
    const data = await this.usersService.getMe(user.userId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  /**
   * Modifie les infos de base du profil : prénom, nom, username, langue, photo, genre.
   * Email et téléphone sont modifiés via leurs routes dédiées (avec OTP).
   */
  @Patch('me')
  async updateUserProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUserProfileDto,
  ): Promise<ApiResponse<SafeUser>> {
    const data = await this.usersService.updateUserProfile(user.userId, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  /**
   * Change l'email de l'utilisateur.
   * Pré-requis : vérification OTP via POST /auth/send-otp/email + /auth/verify-otp.
   * L'ancien email est archivé dans previousEmails[] pour la synchro des contacts.
   */
  @Patch('me/email')
  async updateEmail(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateEmailDto,
  ): Promise<ApiResponse<SafeUser>> {
    const data = await this.usersService.updateEmail(user.userId, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  /**
   * Change le numéro de téléphone de l'utilisateur.
   * Pré-requis : vérification OTP via POST /auth/send-otp/phone + /auth/verify-otp.
   * L'ancien numéro est archivé dans previousPhoneNumbers[] pour la synchro des contacts.
   */
  @Patch('me/phone')
  async updatePhone(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePhoneDto,
  ): Promise<ApiResponse<SafeUser>> {
    const data = await this.usersService.updatePhone(user.userId, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  /**
   * Change le mot de passe (l'utilisateur doit connaître l'ancien).
   * Pour le reset (mot de passe oublié) → POST /auth/reset-password.
   */
  @Patch('me/password')
  async updatePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePasswordDto,
  ): Promise<ApiResponse<{ message: string }>> {
    await this.usersService.updatePassword(user.userId, dto);
    return {
      success: true,
      data: { message: 'Mot de passe mis à jour avec succès.' },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Met à jour le token FCM pour les push notifications.
   * Appelé par le front à chaque ouverture de l'app ou après un login.
   */
  @Patch('me/fcm-token')
  async updateFcmToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateFcmTokenDto,
  ): Promise<ApiResponse<null>> {
    await this.usersService.updateFcmToken(user.userId, dto.fcmToken);
    return {
      success: true,
      data: null,
      message: 'Token FCM mis à jour.',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Recherche des utilisateurs Humlinker inscrits.
   * Utilisé lors de la création d'un humlinker pour trouver un contact inscrit
   * et récupérer son targetUserId.
   *
   * Query params :
   *  - q     : terme de recherche (username, prénom, nom, email, téléphone)
   *  - limit : nombre max de résultats (1–50, défaut 10)
   *
   * Retourne uniquement les utilisateurs non-placeholder.
   * Les champs sensibles (passwordHash, fcmToken) sont exclus.
   */
  @Get('search')
  async searchUsers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SearchUsersQueryDto,
  ): Promise<ApiResponse<SafeUser[]>> {
    const data = await this.usersService.searchUsers(user.userId, query);
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
