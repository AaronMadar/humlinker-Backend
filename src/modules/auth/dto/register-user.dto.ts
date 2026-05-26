/**
 * RegisterUserDto
 *
 * Données attendues lors de l'inscription classique (email + téléphone + mot de passe).
 *
 * IMPORTANT : email, phoneNumber et username sont OBLIGATOIRES.
 * Avant d'appeler cette route, le front doit avoir vérifié l'email et le téléphone
 * via le flow OTP (POST /auth/send-otp/email → POST /auth/verify-otp).
 * Le backend vérifie côté serveur que les flags Redis "verified" sont présents
 * pour bloquer les appels directs API (Postman, curl...).
 *
 * Note : firstName, lastName et gender sont optionnels à l'inscription.
 * L'utilisateur peut les renseigner plus tard dans son profil.
 */
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import type { UserGender } from '../../users/entities';

const GENDERS: UserGender[] = ['male', 'female', 'other'];

export class RegisterUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @IsNotEmpty()
  language!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  firstName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  lastName?: string;

  @IsOptional()
  @IsEnum(GENDERS)
  gender?: UserGender;
}
