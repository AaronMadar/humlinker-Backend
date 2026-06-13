import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import type { ApiResponse as AppApiResponse } from '../../common';
import { CurrentUser } from '../../decorators';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { MessagesService, type ChatResponse, type SafeDraft } from './messages.service';
import { SendMessageDto } from './dto/send-message.dto';

@ApiTags('Messages')
@ApiBearerAuth()
@Controller('humlinkers/:humhlinkerId')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('messages')
  @ApiOperation({
    summary: 'Charger le chat',
    description:
      "Retourne les 30 derniers messages du chat (ordre chronologique) + le draft actif sans `realMessage` (pour ne pas exposer le message final avant envoi). Utiliser `offset` pour le lazy load (scroll vers le haut).",
  })
  @ApiParam({ name: 'humhlinkerId', description: 'UUID du humlinker.', example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  @ApiQuery({ name: 'limit', required: false, description: 'Nombre de messages à charger (défaut 30).', example: 30 })
  @ApiQuery({ name: 'offset', required: false, description: "Offset pour le scroll infini vers le haut (défaut 0).", example: 0 })
  @ApiResponse({ status: 200, description: '`messages[]` + `activeDraft` (sans realMessage).' })
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
  @ApiOperation({
    summary: 'Envoyer un message à l\'IA',
    description:
      "Envoie le message de l'utilisateur à Gemini. L'IA met à jour le draft actif (`objectiveMessage` + `realMessage`). Le `realMessage` est le message final qui sera envoyé au destinataire.",
  })
  @ApiParam({ name: 'humhlinkerId', description: 'UUID du humlinker.', example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  @ApiResponse({ status: 201, description: '`activeDraft` mis à jour.' })
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

  @Post('send')
  @ApiOperation({
    summary: 'Envoyer le draft au destinataire',
    description:
      "Envoie le `realMessage` du draft actif au target selon le canal configuré (`app` / `sms` / `whatsapp` / `email`). Archive le draft envoyé dans l'historique et retourne un draft vide pour la prochaine itération.",
  })
  @ApiParam({ name: 'humhlinkerId', description: 'UUID du humlinker.', example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  @ApiResponse({ status: 201, description: 'Message envoyé au target — draft vide retourné.' })
  @ApiResponse({ status: 400, description: 'Aucun draft actif à envoyer.' })
  @ApiResponse({ status: 403, description: "L'utilisateur n'est pas le sender de ce humlinker." })
  async sendDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('humhlinkerId', ParseUUIDPipe) humhlinkerId: string,
  ): Promise<AppApiResponse<SafeDraft>> {
    const data = await this.messagesService.sendDraft(humhlinkerId, user.userId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
