/**
 * UpdateFcmTokenDto
 *
 * Données pour mettre à jour le token FCM Firebase de l'utilisateur.
 * Appelé par le front à chaque ouverture de l'app ou après un login.
 *
 * Le token FCM est stocké côté serveur pour l'envoi des push notifications
 * quand l'app est fermée ou en arrière-plan.
 */
import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateFcmTokenDto {
  @IsString()
  @IsNotEmpty()
  fcmToken!: string;
}
