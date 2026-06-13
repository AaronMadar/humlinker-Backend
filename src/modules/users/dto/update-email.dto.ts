import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateEmailDto {
  @ApiProperty({
    example: 'nouveau@gmail.com',
    description: "Nouvel email — doit avoir été vérifié via OTP avant cet appel.",
  })
  @IsEmail()
  newEmail!: string;
}
