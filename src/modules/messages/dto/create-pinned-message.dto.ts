import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import type { MessageChannel, PinnedMessageStatus } from '../entities';

const CHANNELS: MessageChannel[] = ['app', 'whatsapp', 'sms', 'email'];
const STATUSES: PinnedMessageStatus[] = ['active', 'sent'];

export class CreatePinnedMessageDto {

  @IsString()
  @IsNotEmpty()
  objectiveMessage: string;
}
