import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    example: 'john.doe@gmail.com',
    description: "Email ou numéro de téléphone de l'utilisateur.",
  })
  @IsString()
  @IsNotEmpty()
  identifier!: string;

  @ApiProperty({ example: 'Motdepasse1!', description: 'Mot de passe (min 8 caractères).', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;
}
