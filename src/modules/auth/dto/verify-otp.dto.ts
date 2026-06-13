import { IsEnum, IsNotEmpty, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyOtpDto {
  @ApiProperty({
    example: 'john.doe@gmail.com',
    description: "Email ou numéro de téléphone auquel le code a été envoyé.",
  })
  @IsString()
  @IsNotEmpty()
  target!: string;

  @ApiProperty({
    example: '048392',
    description: 'Code OTP à 6 chiffres reçu par email ou SMS.',
    minLength: 6,
    maxLength: 6,
  })
  @IsString()
  @Length(6, 6, { message: 'Le code doit contenir exactement 6 chiffres.' })
  code!: string;

  @ApiProperty({
    enum: ['email', 'phone'],
    example: 'email',
    description: "Type de l'identifiant vérifié.",
  })
  @IsEnum(['email', 'phone'])
  type!: 'email' | 'phone';
}
