import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyPhoneTokenDto {
  @ApiProperty({
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6...',
    description:
      "ID Token Firebase obtenu apres verification du numero de telephone via Firebase Phone Auth SDK. Le backend extrait et verifie le numero de telephone depuis ce token.",
  })
  @IsString()
  @IsNotEmpty()
  firebaseToken!: string;
}
