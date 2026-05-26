/**
 * SmsService
 *
 * Responsable de l'envoi des SMS via Twilio.
 * Actuellement utilisé pour :
 *  - Envoyer le code OTP lors de la vérification du numéro de téléphone à l'inscription.
 *  - Envoyer les invitations Humlinker aux destinataires sans compte (via SMS).
 *
 * La config Twilio est lue depuis APP_CONFIG (accountSid, authToken, phoneNumber).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import twilio from 'twilio';
import { APP_CONFIG } from '../../config';
import configuration from '../../config/configuration';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly client: twilio.Twilio;

  constructor(
    @Inject(APP_CONFIG)
    private readonly config: ReturnType<typeof configuration>,
  ) {
    // Création du client Twilio une seule fois à l'injection
    this.client = twilio(config.twilio.accountSid, config.twilio.authToken);
  }

  /**
   * Envoie un code OTP par SMS au numéro fourni.
   *
   * Flow :
   *  Front demande OTP → OtpService génère le code → SmsService envoie le SMS
   *  → Utilisateur tape le code dans le formulaire → OtpService vérifie.
   */
  async sendOtp(phoneNumber: string, code: string): Promise<void> {
    try {
      await this.client.messages.create({
        body: `Votre code de vérification Humlinker est : ${code}\nExpire dans 5 minutes.`,
        from: this.config.twilio.phoneNumber,
        to: phoneNumber,
      });
      this.logger.log(`OTP SMS sent to ${phoneNumber}`);
    } catch (error) {
      this.logger.error(`Failed to send OTP SMS to ${phoneNumber}`, error);
      throw error;
    }
  }

  /**
   * Envoie un SMS personnalisé (ex: invitation Humlinker à un destinataire non inscrit).
   */
  async sendMessage(phoneNumber: string, message: string): Promise<void> {
    try {
      await this.client.messages.create({
        body: message,
        from: this.config.twilio.phoneNumber,
        to: phoneNumber,
      });
      this.logger.log(`SMS sent to ${phoneNumber}`);
    } catch (error) {
      this.logger.error(`Failed to send SMS to ${phoneNumber}`, error);
      throw error;
    }
  }
}
