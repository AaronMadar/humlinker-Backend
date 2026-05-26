/**
 * PrismaChatMessageRepository
 *
 * Implémentation Prisma du ChatMessageRepository.
 * Les messages sont stockés dans la table chat_messages.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database';
import type { ChatMessage } from '../../humlinker/entities';
import type {
  ChatMessageRepository,
  CreateChatMessageData,
} from './chat-message.repository';

const DEFAULT_LIMIT = 30;

@Injectable()
export class PrismaChatMessageRepository implements ChatMessageRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByHumlinker(
    humhlinkerId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<ChatMessage[]> {
    const { limit = DEFAULT_LIMIT, offset = 0 } = options;

    // On charge DESC (plus récents en premier) pour la pagination,
    // le service inverse le tableau pour l'affichage chronologique.
    const rows = await this.prisma.chatMessage.findMany({
      where: { humhlinkerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    // Réinverser pour ordre chronologique (du plus ancien au plus récent)
    return rows.reverse().map(this.toChatMessage);
  }

  async create(data: CreateChatMessageData): Promise<ChatMessage> {
    const row = await this.prisma.chatMessage.create({
      data: {
        humhlinkerId: data.humhlinkerId,
        role: data.role,
        type: data.type,
        content: data.content,
        draftId: data.draftId ?? null,
      },
    });
    return this.toChatMessage(row);
  }

  private toChatMessage(row: {
    id: string;
    humhlinkerId: string;
    role: string;
    type: string;
    content: string;
    draftId: string | null;
    createdAt: Date;
  }): ChatMessage {
    return {
      _id: row.id,
      humhlinkerId: row.humhlinkerId,
      role: row.role as ChatMessage['role'],
      type: row.type as ChatMessage['type'],
      content: row.content,
      draftId: row.draftId,
      createdAt: row.createdAt,
    };
  }
}
