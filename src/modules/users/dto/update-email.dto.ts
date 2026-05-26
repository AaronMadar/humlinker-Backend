/**
 * UpdateEmailDto
 *
 * Données pour changer l'email depuis le profil.
 * Le front doit avoir vérifié le nouvel email via OTP avant cet appel
 * (POST /auth/send-otp/email → POST /auth/verify-otp).
 * Le backend vérifie le flag Redis verified:email:{newEmail}.
 */
import { IsEmail } from 'class-validator';

export class UpdateEmailDto {
  @IsEmail()
  newEmail!: string;
}
