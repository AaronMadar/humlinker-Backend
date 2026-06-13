import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdatePhoneDto {
  @ApiProperty({
    example: '+33699999999',
    description: "Nouveau numéro de téléphone (E.164) — doit avoir été vérifié via OTP avant cet appel.",
  })
  @IsString()
  @IsNotEmpty()
  newPhoneNumber!: string;
}
