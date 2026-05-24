import { IsNotEmpty , IsString } from 'class-validator';
import type { MessageChannel, MessageSenderType, MessageStatus } from '../entities';

const CHANNELS: MessageChannel[] = ['app', 'whatsapp', 'sms', 'email'];
const SENDER_TYPES: MessageSenderType[] = ['user', 'ai', 'system'];
const STATUSES: MessageStatus[] = ['sending', 'sent', 'failed'];

export class CreateMessageDto {   
 
  @IsString()
  @IsNotEmpty()
  content: string;
}


 
