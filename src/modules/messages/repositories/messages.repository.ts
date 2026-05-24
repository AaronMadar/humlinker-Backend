import type { Message, PinnedMessage } from '../entities';

export interface MessagesRepository {
  createMessage(message: Message): Promise<Message>;
  listByHumlinkerId(humlinkerId: string): Promise<Message[]>;
}

export interface PinnedMessagesRepository {
  findActiveByHumlinkerId(humlinkerId: string): Promise<PinnedMessage | null>;
  createPinnedMessage(pinnedMessage: PinnedMessage): Promise<PinnedMessage>;
  deactivateActivePinnedMessage(humlinkerId: string): Promise<void>;
}
