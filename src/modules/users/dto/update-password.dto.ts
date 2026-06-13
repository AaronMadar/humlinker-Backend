import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdatePasswordDto {
  @ApiProperty({ example: 'AncienMotdepasse1!', description: 'Mot de passe actuel.', minLength: 8 })
  @IsString()
  @MinLength(8)
  currentPassword!: string;

  @ApiProperty({ example: 'NouveauMotdepasse1!', description: 'Nouveau mot de passe (min 8 caractères).', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
