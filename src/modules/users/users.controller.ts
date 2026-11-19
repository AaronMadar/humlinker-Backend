import { Body, Controller, Delete, Get, HttpCode, Patch, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import type { ApiResponse as AppApiResponse } from '@/common';
import { CurrentUser } from '@/decorators';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import type { PublicUser, SafeUser } from '@/utils';
import { HOUR, MINUTE, RateLimit } from '@/common/rate-limit';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { AccountDeletionService } from './account-deletion.service';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UpdateEmailDto } from './dto/update-email.dto';
import { UpdatePhoneDto } from './dto/update-phone.dto';
import { UpdateFcmTokenDto } from './dto/update-fcm-token.dto';
import { SearchUsersQueryDto } from './dto/search-users-query.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly accountDeletion: AccountDeletionService,
  ) {}

  @Delete('me')
  @HttpCode(200)
  @RateLimit({ name: 'account-delete', by: 'user', limit: 5, windowSec: HOUR })
  @ApiOperation({
    summary: 'Supprimer mon compte (RGPD)',
    description:
      "Résilie l'abonnement, supprime mes conversations et anonymise le compte. Irréversible. Mot de passe requis pour les comptes avec mot de passe.",
  })
  async deleteMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DeleteAccountDto,
  ): Promise<AppApiResponse<{ message: string }>> {
    await this.accountDeletion.deleteAccount(user.userId, dto.password);
    return { success: true, data: { message: 'Compte supprimé.' }, timestamp: new Date().toISOString() };
  }

  @Get('me')
  @ApiOperation({ summary: 'Mon profil' })
  async getMe(@CurrentUser() user: AuthenticatedUser): Promise<AppApiResponse<SafeUser>> {
    const data = await this.usersService.getMe(user.userId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch('me')
  @ApiOperation({ summary: 'Modifier mon profil', description: 'Met à jour prénom, nom, langue, photo de profil ou genre.' })
  async updateUserProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUserProfileDto,
  ): Promise<AppApiResponse<SafeUser>> {
    const data = await this.usersService.updateUserProfile(user.userId, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch('me/email')
  @ApiOperation({ summary: 'Changer mon email' })
  async updateEmail(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateEmailDto,
  ): Promise<AppApiResponse<SafeUser>> {
    const data = await this.usersService.updateEmail(user.userId, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch('me/phone')
  @ApiOperation({ summary: 'Changer mon numéro de téléphone' })
  async updatePhone(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePhoneDto,
  ): Promise<AppApiResponse<SafeUser>> {
    const data = await this.usersService.updatePhone(user.userId, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch('me/password')
  @ApiOperation({
    summary: 'Changer mon mot de passe',
    description:
      "Déconnecte tous les autres appareils. Renvoie un nouveau jeton d'accès pour cet appareil (à stocker à la place de l'ancien).",
  })
  async updatePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePasswordDto,
  ): Promise<AppApiResponse<{ message: string; token: string; refreshToken?: string }>> {
    // Les autres appareils sont déconnectés ; celui-ci reçoit un nouveau jeton
    const tokens = await this.usersService.updatePassword(user.userId, dto, user.sid);
    return {
      success: true,
      data: { message: 'Mot de passe mis à jour.', ...tokens },
      timestamp: new Date().toISOString(),
    };
  }

  @Patch('me/fcm-token')
  @ApiOperation({ summary: 'Mettre à jour le token FCM' })
  async updateFcmToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateFcmTokenDto,
  ): Promise<AppApiResponse<null>> {
    await this.usersService.updateFcmToken(user.userId, dto.fcmToken);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }

  @Get('search')
  @RateLimit({ name: 'minute', by: 'user', limit: 30, windowSec: MINUTE })
  @ApiOperation({ summary: 'Rechercher par PIN', description: 'Recherche un utilisateur inscrit par son PIN exact (8 caractères, insensible à la casse).' })
  @ApiQuery({ name: 'q', description: 'PIN du destinataire (ex: A1B2C3D4)', example: 'A1B2C3D4' })
  @ApiResponse({ status: 200, description: 'Utilisateur trouvé ou liste vide.' })
  async searchUsers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: SearchUsersQueryDto,
  ): Promise<AppApiResponse<PublicUser[]>> {
    const data = await this.usersService.searchUsers(user.userId, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
