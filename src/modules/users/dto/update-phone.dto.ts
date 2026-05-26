/**
 * UpdatePhoneDto
 *
 * Données pour changer le numéro de téléphone depuis le profil.
 * Le front doit avoir vérifié le nouveau numéro via OTP avant cet appel
 * (POST /auth/send-otp/phone → POST /auth/verify-otp).
 * Le backend vérifie le flag Redis verified:phone:{newPhone}.
 */
import { IsNotEmpty, IsString } from 'class-validator';

export class UpdatePhoneDto {
  @IsString()
  @IsNotEmpty()
  newPhoneNumber!: string;
}
