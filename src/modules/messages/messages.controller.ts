import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import type { ApiResponse as AppApiResponse } from '../../common';
import { CurrentUser } from '../../decorators';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { MessagesService, type ChatResponse, type SafeDraft } from './messages.service';
import { SendMessageDto, RestoreDraftVersionDto } from './dto';

@ApiTags('Messages')
@ApiBearerAuth()
@Controller('humlinkers/:humhlinkerId')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('messages')
  @ApiOperation({ summary: 'Charger le chat', description: 'Retourne les 30 derniers messages + activeDraft + draftVersions.' })
  @ApiParam({ name: 'humhlinkerId', example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  @ApiQuery({ name: 'limit', required: false, example: 30 })
  @ApiQuery({ name: 'offset', required: false, example: 0 })
  @ApiResponse({ status: 200, description: 'messages[] + activeDraft + draftVersions.' })
  @ApiResponse({ status: 403, description: "L'utilisateur n'est pas participant de ce humlinker." })
  @ApiResponse({ status: 404, description: 'Humlinker introuvable.' })
  async getChat(
    @CurrentUser() user: AuthenticatedUser,
    @Param('humhlinkerId', ParseUUIDPipe) humhlinkerId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<AppApiResponse<ChatResponse>> {
    const data = await this.messagesService.getChat(humhlinkerId, user.userId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post('messages')
  @ApiOperation({ summary: "Envoyer un message a l'IA", description: "L'IA met a jour le draft actif." })
  @ApiParam({ name: 'humhlinkerId', example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  @ApiResponse({ status: 201, description: 'activeDraft mis a jour.' })
  @ApiResponse({ status: 403, description: "L'utilisateur n'est pas le sender de ce humlinker." })
  @ApiResponse({ status: 404, description: 'Humlinker introuvable.' })
  async sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('humhlinkerId', ParseUUIDPipe) humhlinkerId: string,
    @Body() dto: SendMessageDto,
  ): Promise<AppApiResponse<{ activeDraft: SafeDraft }>> {
    const data = await this.messagesService.sendMessage(humhlinkerId, user.userId, dto.content);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch('draft')
  @ApiOperation({ summary: 'Restaurer une version precedente du draft', description: "Restaure objectiveMessage + realMessage depuis le cache Redis. Aucun appel IA." })
  @ApiParam({ name: 'humhlinkerId', example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  @ApiResponse({ status: 200, description: 'Draft restaure.' })
  @ApiResponse({ status: 403, description: "L'utilisateur n'est pas le sender de ce humlinker." })
  @ApiResponse({ status: 404, description: 'Humlinker ou version introuvable.' })
  async restoreDraftVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('humhlinkerId', ParseUUIDPipe) humhlinkerId: string,
    @Body() dto: RestoreDraftVersionDto,
  ): Promise<AppApiResponse<{ activeDraft: SafeDraft; draftVersions: string[] }>> {
    const data = await this.messagesService.restoreDraftVersion(humhlinkerId, user.userId, dto.versionIndex);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post('send')
  @ApiOperation({ summary: 'Envoyer le draft au destinataire', description: 'Envoie le realMessage au target et supprime les versions en cache.' })
  @ApiParam({ name: 'humhlinkerId', example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  @ApiResponse({ status: 201, description: 'Message envoye - draft vide retourne.' })
  @ApiResponse({ status: 400, description: 'Aucun draft actif a envoyer.' })
  @ApiResponse({ status: 403, description: "L'utilisateur n'est pas le sender de ce humlinker." })
  async sendDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('humhlinkerId', ParseUUIDPipe) humhlinkerId: string,
  ): Promise<AppApiResponse<SafeDraft>> {
    const data = await this.messagesService.sendDraft(humhlinkerId, user.userId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
