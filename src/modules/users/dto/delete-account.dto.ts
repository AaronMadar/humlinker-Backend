import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class DeleteAccountDto {
  @ApiPropertyOptional({
    description: 'Mot de passe actuel (obligatoire si le compte en a un).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  password?: string;
}
