import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
} from 'class-validator';
import type {
  UserAuthProvider,
  UserGender,
  UserPlaceholderSource,
} from '../entities';

const GENDERS: UserGender[] = ['male', 'female', 'other'];
const AUTH_PROVIDERS: UserAuthProvider[] = ['local', 'google'];
const PLACEHOLDER_SOURCES: Exclude<UserPlaceholderSource, null>[] = [
  'humlinker_invitation',
  'manual',
];

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @IsString()
  @IsNotEmpty()

  @IsEnum(GENDERS)
  gender!: UserGender;

  @IsString()
  @IsNotEmpty()
  language!: string;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  phoneNumber?: string | null;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(AUTH_PROVIDERS, { each: true })
  authProviders?: UserAuthProvider[];

  @IsOptional()
  @IsUrl()
  profilePicture?: string | null;

  @IsOptional()
  @IsBoolean()
  isPlaceholder?: boolean;

  @IsOptional()
  @IsIn([...PLACEHOLDER_SOURCES, null])
  placeholderSource?: UserPlaceholderSource;
}
