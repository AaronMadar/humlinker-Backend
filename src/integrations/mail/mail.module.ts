/**
 * MailModule — fournit MailService pour l'envoi d'emails via SMTP.
 * Importé dans IntegrationsModule.
 */
import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
