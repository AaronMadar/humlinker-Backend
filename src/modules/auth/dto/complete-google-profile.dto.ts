import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CompleteGoogleProfileDto {
  @ApiProperty({ example: '+33612345678', description: 'Numéro de téléphone vérifié via OTP (format E.164).' })
  @IsString()
  @IsNotEmpty()
  phoneNumber!: string;

  @ApiProperty({ example: 'fr', description: "Code de langue BCP-47 (ex: 'fr', 'en', 'es')." })
  @IsString()
  @IsNotEmpty()
  language!: string;
}
