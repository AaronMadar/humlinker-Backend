import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateFcmTokenDto {
  @ApiProperty({
    example: 'fHx8kq3zRp2...',
    description: "Token FCM Firebase pour les push notifications. Envoyé à chaque login ou ouverture de l'app.",
  })
  @IsString()
  @IsNotEmpty()
  fcmToken!: string;
}
