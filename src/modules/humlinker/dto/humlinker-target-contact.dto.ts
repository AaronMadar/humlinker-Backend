import { IsEmail, IsOptional, IsString } from 'class-validator';

export class HumlinkerTargetContactDto {
  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  phoneNumber?: string | null;
}
