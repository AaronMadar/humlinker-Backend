/**
 * VerifyOtpDto — données pour vérifier un code OTP.
 * Utilisé sur POST /auth/verify-otp
 *
 * - target : l'email ou le numéro de téléphone auquel le code a été envoyé
 * - code   : le code à 6 chiffres reçu par l'utilisateur
 * - type   : 'email' ou 'phone' pour savoir quelle clé Redis vérifier
 */
import { IsEnum, IsNotEmpty, IsString, Length } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  @IsNotEmpty()
  target!: string; // email ou numéro de téléphone

  @IsString()
  @Length(6, 6, { message: 'Le code doit contenir exactement 6 chiffres.' })
  code!: string;

  @IsEnum(['email', 'phone'])
  type!: 'email' | 'phone';
}
