import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendOtpEmailDto {
  @ApiProperty({
    example: 'john.doe@gmail.com',
    description: 'Adresse email à laquelle envoyer le code OTP.',
  })
  @IsEmail()
  email!: string;
}

export class SendOtpPhoneDto {
  @ApiProperty({
    example: '+33612345678',
    description: 'Numéro de téléphone au format international E.164.',
  })
  @IsString()
  @IsNotEmpty()
  phoneNumber!: string;
}
