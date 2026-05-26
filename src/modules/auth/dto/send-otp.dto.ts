/**
 * SendOtpEmailDto — données pour envoyer un OTP par email.
 * Utilisé sur POST /auth/send-otp/email
 */
import { IsEmail } from 'class-validator';

export class SendOtpEmailDto {
  @IsEmail()
  email!: string;
}

/**
 * SendOtpPhoneDto — données pour envoyer un OTP par SMS.
 * Utilisé sur POST /auth/send-otp/phone
 */
import { IsNotEmpty, IsString } from 'class-validator';

export class SendOtpPhoneDto {
  @IsString()
  @IsNotEmpty()
  phoneNumber!: string;
}
