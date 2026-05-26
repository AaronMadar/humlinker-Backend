/**
 * SmsModule — fournit SmsService pour l'envoi de SMS via Twilio.
 * Importé dans IntegrationsModule.
 */
import { Module } from '@nestjs/common';
import { SmsService } from './sms.service';

@Module({
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
