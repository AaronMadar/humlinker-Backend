/**
 * IntegrationsModule
 *
 * Regroupe tous les services tiers (email, SMS, etc.).
 * @Global() → disponible dans toute l'application sans réimport.
 *
 * Services disponibles :
 *  - MailService  → envoi d'emails via SMTP (Nodemailer)
 *  - SmsService   → envoi de SMS via Twilio
 */
import { Global, Module } from '@nestjs/common';
import { MailModule } from './mail/mail.module';
import { SmsModule } from './sms/sms.module';

@Global()
@Module({
  imports: [MailModule, SmsModule],
  exports: [MailModule, SmsModule],
})
export class IntegrationsModule {}
