/**
 * PrismaChatMessageRepository
 *
 * Implémentation Prisma du ChatMessageRepository.
 * Les messages sont stockés dans la table chat_messages.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/database';
import type { ChatMessage } from '@/modules/humlinker/entities';
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

    const rows = await this.prisma.chatMessage.findMany({
      where: { humhlinkerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    return rows.reverse().map((r) => this.toChatMessage(r as never));
  }

  async create(data: CreateChatMessageData): Promise<ChatMessage> {
    const row = await this.prisma.chatMessage.create({
      data: {
        humhlinkerId: data.humhlinkerId,
        role: data.role as never,
        type: data.type as never,
        content: data.content,
        draftId: data.draftId ?? null,
      },
    });
    return this.toChatMessage(row as never);
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
