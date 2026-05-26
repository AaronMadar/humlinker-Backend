/**
 * MailService
 *
 * Responsable de l'envoi des emails via Nodemailer (SMTP).
 * Actuellement utilisé pour :
 *  - Envoyer le code OTP lors de la vérification de l'email au moment de l'inscription.
 *
 * La config SMTP est lue depuis APP_CONFIG (host, port, user, pass, from).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { APP_CONFIG } from '../../config';
import configuration from '../../config/configuration';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(
    @Inject(APP_CONFIG)
    private readonly config: ReturnType<typeof configuration>,
  ) {
    // Création du transporter SMTP une seule fois à l'injection du service
    this.transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.port === 465, // true pour le port 465 (SSL), false pour 587 (TLS)
      auth: {
        user: config.mail.user,
        pass: config.mail.password,
      },
    });
  }

  /**
   * Envoie un code OTP à l'adresse email fournie.
   *
   * Flow :
   *  Front demande OTP → OtpService génère le code → MailService envoie l'email
   *  → Utilisateur tape le code dans le formulaire → OtpService vérifie.
   */
  async sendOtp(email: string, code: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.config.mail.from,
        to: email,
        subject: 'Votre code de vérification Humlinker',
        text: `Votre code de vérification est : ${code}\n\nCe code expire dans 5 minutes.`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
            <h2 style="color: #333;">Vérification de votre email</h2>
            <p>Votre code de vérification Humlinker est :</p>
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #4F46E5; padding: 16px 0;">
              ${code}
            </div>
            <p style="color: #666; font-size: 13px;">Ce code expire dans <strong>5 minutes</strong>.</p>
          </div>
        `,
      });
      this.logger.log(`OTP email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send OTP email to ${email}`, error);
      throw error;
    }
  }
}
