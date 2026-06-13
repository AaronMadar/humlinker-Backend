import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { HumlinkerChannel } from '../entities';

const CHANNELS: HumlinkerChannel[] = ['app', 'email'];

export class CreateHumlinkerDto {
  @ApiProperty({ example: 'Philippe', description: 'Prenom du destinataire.' })
  @IsString()
  @IsNotEmpty()
  targetFirstName: string;

  @ApiPropertyOptional({ example: 'Martin', description: 'Nom de famille du destinataire.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  targetLastName?: string;

  @ApiPropertyOptional({
    example: 'philippe@company.com',
    description: 'Email du destinataire (pour les non-inscrits). Obligatoire si targetUserId est absent et canal = email.',
  })
  @IsOptional()
  @IsEmail()
  targetContactEmail?: string | null;

  @ApiPropertyOptional({
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    description: "UUID d'un utilisateur Humlinker déjà inscrit (trouvé via PIN).",
  })
  @IsOptional()
  @IsString()
  targetUserId?: string;

  @ApiProperty({ example: 'collegue', description: "Type de relation (contexte pour l'IA)." })
  @IsString()
  @IsNotEmpty()
  relationshipType: string;

  @ApiProperty({ enum: CHANNELS, example: 'app', description: "'app' si le target est inscrit, 'email' sinon." })
  @IsEnum(CHANNELS)
  communicationChannel: HumlinkerChannel;

  @ApiProperty({ example: 'fr', description: 'Langue du destinataire (si non inscrit).' })
  @IsString()
  @IsNotEmpty()
  targetLanguage: string;
}
