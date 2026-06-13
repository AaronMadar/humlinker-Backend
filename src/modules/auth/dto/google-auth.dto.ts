import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GoogleAuthDto {
  @ApiProperty({
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6...',
    description: "ID Token obtenu côté client via Google Sign-In SDK.",
  })
  @IsString()
  @IsNotEmpty()
  idToken!: string;
}
