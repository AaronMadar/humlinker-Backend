import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendMessageDto {
  @ApiProperty({
    example: 'Je veux remercier Philippe pour son aide sur le projet, il a vraiment été disponible.',
    description: "Message de l'utilisateur adressé à l'IA. L'IA reformule ce message en draft poli pour le destinataire.",
    maxLength: 4000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content: string;
}
