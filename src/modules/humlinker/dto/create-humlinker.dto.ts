import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import type { HumlinkerChannel } from '../entities';
import { HumlinkerTargetContactDto } from './humlinker-target-contact.dto';

const CHANNELS: HumlinkerChannel[] = ['whatsapp', 'sms', 'email', 'app'];

export class CreateHumlinkerDto {
  @IsString()
  @IsNotEmpty()
  targetContactName: string;

  @ValidateNested()
  @Type(() => HumlinkerTargetContactDto)
  targetContact: HumlinkerTargetContactDto;

  @IsString()
  @IsNotEmpty()
  relationshipType: string;

  @IsEnum(CHANNELS)
  communicationChannel: HumlinkerChannel;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  language: string;

  @IsOptional()
  @IsString()
  participantUserId?: string;
}
