import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import type { ApiResponse as AppApiResponse } from '@/common';
import { CurrentUser } from '@/decorators';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import type { SafeUser } from '@/utils';
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
  constructor(private readonly usersService: UsersService) {}

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
  @ApiOperation({ summary: 'Changer mon mot de passe' })
  async updatePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePasswordDto,
  ): Promise<AppApiResponse<{ message: string }>> {
    await this.usersService.updatePassword(user.userId, dto);
    return { success: true, data: { message: 'Mot de passe mis à jour.' }, timestamp: new Date().toISOString() };
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
  @ApiOperation({ summary: 'Rechercher par PIN', description: 'Recherche un utilisateur inscrit par son PIN exact (8 caractères, insensible à la casse).' })
  @ApiQuery({ name: 'q', description: 'PIN du destinataire (ex: A1B2C3D4)', example: 'A1B2C3D4' })
  @ApiResponse({ status: 200, description: 'Utilisateur trouvé ou liste vide.' })
  async searchUsers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: SearchUsersQueryDto,
  ): Promise<AppApiResponse<SafeUser[]>> {
    const data = await this.usersService.searchUsers(user.userId, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
