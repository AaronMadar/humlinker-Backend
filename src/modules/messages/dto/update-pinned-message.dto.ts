import { PartialType } from '@nestjs/mapped-types';
import { CreatePinnedMessageDto } from './create-pinned-message.dto';

export class UpdatePinnedMessageDto extends PartialType(CreatePinnedMessageDto) {}
