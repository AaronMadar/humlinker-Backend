/**
 * ResetPasswordDto
 *
 * Données pour réinitialiser le mot de passe oublié.
 * Utilisé sur POST /auth/reset-password.
 *
 * Le front doit avoir vérifié l'email OU le téléphone via OTP avant cet appel.
 * Le backend cherche le flag Redis verified:email:{identifier} ou verified:phone:{identifier}.
 *
 * - identifier : l'email ou le numéro de téléphone utilisé pour le reset
 * - type       : 'email' ou 'phone' (indique quel flag Redis vérifier)
 * - newPassword : le nouveau mot de passe
 */
import { IsEnum, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  identifier!: string;

  @IsEnum(['email', 'phone'])
  type!: 'email' | 'phone';

  @IsString()
  @MinLength(8)
  newPassword!: string;
}
