import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty({ description: 'Jeton de rafraîchissement reçu à la connexion ou au dernier /auth/refresh.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  refreshToken!: string;
}
