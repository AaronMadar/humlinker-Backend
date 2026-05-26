import {
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  IsNotEmpty,
} from 'class-validator';
import type { UserGender } from '../entities';

const GENDERS: UserGender[] = ['male', 'female', 'other'];

export class UpdateUserProfileDto {
  @IsOptional()
  @IsString()
  firstName?: string | null;

  @IsOptional()
  @IsString()
  lastName?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  username?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  language?: string;

  @IsOptional()
  @IsUrl()
  profilePicture?: string | null;

  @IsOptional()
  @IsEnum(GENDERS)
  gender?: UserGender | null;
}
