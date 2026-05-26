export type MessageChannel = 'app' | 'whatsapp' | 'sms' | 'email';

export type PinnedMessageStatus = 'active' | 'sent';

export interface PinnedMessage {
  _id: string;
  humlinkerId: string;
  objectiveMessage: string;
  status: PinnedMessageStatus;
  version: number;
  finalContent: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Domain rule:
 * Only one "active" pinned message is allowed per humlinker.
 */
