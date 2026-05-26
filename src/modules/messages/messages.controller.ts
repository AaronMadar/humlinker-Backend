/**
 * MessagesController
 *
 * Expose les routes du chat à l'intérieur d'un humlinker.
 * Toutes ces routes nécessitent un JWT valide.
 *
 * ─── Routes ────────────────────────────────────────────────────────────────
 *
 *  GET  /api/v1/humlinkers/:id/messages      → Charger le chat (lazy 30)
 *  POST /api/v1/humlinkers/:id/messages      → Envoyer un message à l'IA
 *  POST /api/v1/humlinkers/:id/send          → Envoyer le draft actif au target
 *
 * ───────────────────────────────────────────────────────────────────────────
 */
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import type { ApiResponse } from '../../common';
import { CurrentUser } from '../../decorators';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import type { ChatMessage } from '../humlinker/entities';
import {
  MessagesService,
  type ChatResponse,
  type SafeDraft,
} from './messages.service';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('humlinkers/:humhlinkerId')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  /**
   * Charge le chat d'un humlinker.
   * Retourne : messages[] (30 derniers, ordre chronologique) + activeDraft (sans realMessage).
   *
   * Query params :
   *  - limit  : nombre de messages (défaut 30)
   *  - offset : pour le lazy load scroll vers le haut
   */
  @Get('messages')
  async getChat(
    @CurrentUser() user: AuthenticatedUser,
    @Param('humhlinkerId', ParseUUIDPipe) humhlinkerId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<ApiResponse<ChatResponse>> {
    const data = await this.messagesService.getChat(humhlinkerId, user.userId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  /**
   * Envoie un message à l'IA.
   * L'IA retourne une réponse conversationnelle + met à jour le draft actif.
   *
   * Retourne : { aiResponse: ChatMessage, activeDraft: SafeDraft }
   */
  @Post('messages')
  async sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('humhlinkerId', ParseUUIDPipe) humhlinkerId: string,
    @Body() dto: SendMessageDto,
  ): Promise<ApiResponse<{ aiResponse: ChatMessage; activeDraft: SafeDraft }>> {
    const data = await this.messagesService.sendMessage(
      humhlinkerId,
      user.userId,
      dto.content,
    );
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  /**
   * Envoie le draft actif au target.
   * Le realMessage est transmis selon le canal configuré (SMS / WhatsApp / email / app).
   *
   * Retourne le nouveau draft vide (bouton Send inactif) pour la prochaine itération.
   */
  @Post('send')
  async sendDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('humhlinkerId', ParseUUIDPipe) humhlinkerId: string,
  ): Promise<ApiResponse<SafeDraft>> {
    const data = await this.messagesService.sendDraft(humhlinkerId, user.userId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
