import type { MessageChannel } from './pinned-message.entity';

export type MessageSenderType = 'user' | 'ai' | 'system';

export type MessageStatus = 'sending' | 'sent' | 'failed';

export interface Message {
  _id: string;
  humlinkerId: string;
  senderType: MessageSenderType;
  senderUserId: string | null;
  content: string;
  status: MessageStatus;
  createdAt: Date;
}
