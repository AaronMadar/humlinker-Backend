import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { UserGender } from '@/modules/users/entities';

const GENDERS: UserGender[] = ['male', 'female', 'other'];

export class RegisterUserDto {
  @ApiProperty({ example: 'john.doe@gmail.com', description: 'Email vérifié via OTP.' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: '+33612345678', description: 'Numéro de téléphone vérifié via OTP (format E.164).' })
  @IsString()
  @IsNotEmpty()
  phoneNumber!: string;

  @ApiProperty({ example: 'Motdepasse1!', description: 'Mot de passe (min 8 caractères).', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ example: 'fr', description: "Code de langue BCP-47 (ex: 'fr', 'en', 'es')." })
  @IsString()
  @IsNotEmpty()
  language!: string;

  @ApiPropertyOptional({ example: 'John', description: 'Prénom (optionnel).' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe', description: 'Nom de famille (optionnel).' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  lastName?: string;

  @ApiPropertyOptional({ enum: GENDERS, example: 'male', description: 'Genre (optionnel).' })
  @IsOptional()
  @IsEnum(GENDERS)
  gender?: UserGender;
}
