/**
 * ChatMessageRepository — interface du repository des messages du chat.
 *
 * Gère le stockage et la lecture des messages dans le chat d'un humlinker.
 * Lazy load style WhatsApp : on charge les 30 derniers, scroll vers le haut pour plus.
 */
import type { ChatMessage } from '@/modules/humlinker/entities';

export const CHAT_MESSAGE_REPOSITORY = Symbol('CHAT_MESSAGE_REPOSITORY');

export interface ChatMessageRepository {
  /**
   * Charge les messages d'un humlinker, triés par createdAt DESC (les plus récents d'abord),
   * puis inversés côté service pour affichage chronologique.
   * Lazy load : limit + offset pour le scroll vers le haut.
   */
  findByHumlinker(
    humhlinkerId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<ChatMessage[]>;

  /** Crée un message dans le chat */
  create(data: CreateChatMessageData): Promise<ChatMessage>;
}

export interface CreateChatMessageData {
  humhlinkerId: string;
  role: ChatMessage['role'];
  type: ChatMessage['type'];
  content: string;
  draftId?: string | null;
}
