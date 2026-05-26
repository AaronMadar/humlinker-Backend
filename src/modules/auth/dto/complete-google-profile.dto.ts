/**
 * CompleteGoogleProfileDto
 *
 * Données envoyées lors de la complétion du profil Google.
 * Appelé sur POST /auth/complete-profile après le login Google
 * si l'utilisateur est nouveau (requiresProfileCompletion: true).
 *
 * Le front doit avoir au préalable :
 *  1. Vérifié le numéro de téléphone via le flow OTP classique
 *     (POST /auth/send-otp/phone → POST /auth/verify-otp)
 *  2. Envoyé cet objet avec le JWT Google temporaire dans le header Authorization
 *
 * language : langue choisie par l'utilisateur dans l'interface.
 */
import { IsNotEmpty, IsString } from 'class-validator';

export class CompleteGoogleProfileDto {
  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber!: string;

  @IsString()
  @IsNotEmpty()
  language!: string;
}
