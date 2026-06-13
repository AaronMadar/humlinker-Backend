import { IsEnum, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({
    example: 'john.doe@gmail.com',
    description: "Email ou numéro de téléphone préalablement vérifié via OTP.",
  })
  @IsString()
  @IsNotEmpty()
  identifier!: string;

  @ApiProperty({
    enum: ['email', 'phone'],
    example: 'email',
    description: "Type de l'identifiant utilisé pour le reset.",
  })
  @IsEnum(['email', 'phone'])
  type!: 'email' | 'phone';

  @ApiProperty({ example: 'NouveauMotdepasse1!', description: 'Nouveau mot de passe (min 8 caractères).', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
