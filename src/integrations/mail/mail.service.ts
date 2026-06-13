import { Inject, Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { APP_CONFIG } from '@/config';
import configuration from '@/config/configuration';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(
    @Inject(APP_CONFIG)
    private readonly config: ReturnType<typeof configuration>,
  ) {
    this.transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.port === 465,
      auth: {
        user: config.mail.user,
        pass: config.mail.password,
      },
    });
  }

  /**
   * Envoie le message d'un humlinker au destinataire non inscrit par email.
   * One-way : aucune reponse possible. Le destinataire est invite a telecharger Humlinker.
   */
  async sendHumlinkerMessage(
    to: string,
    senderName: string,
    message: string,
    downloadUrl: string,
  ): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.config.mail.from,
        to,
        subject: senderName + ' vous a envoye un message via Humlinker',
        text:
          senderName + ' vous transmet :\n\n"' + message + '"\n\n' +
          'Pour repondre, telechargez Humlinker : ' + downloadUrl + '\n' +
          'Le chat apparaitra et vous pourrez repondre directement.',
        html:
          '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#333;">' +
          '<h2 style="color:#4F46E5;">Message de ' + senderName + '</h2>' +
          '<div style="background:#F9FAFB;border-left:4px solid #4F46E5;padding:16px 20px;border-radius:4px;margin:16px 0;">' +
          '<p style="margin:0;font-size:15px;line-height:1.6;">' + message + '</p>' +
          '</div>' +
          '<p style="color:#555;font-size:14px;">Vous souhaitez repondre ? Telechargez <strong>Humlinker</strong> et le fil apparaitra automatiquement.</p>' +
          '<a href="' + downloadUrl + '" style="display:inline-block;background:#4F46E5;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin-top:8px;">Telecharger Humlinker</a>' +
          '<p style="color:#999;font-size:12px;margin-top:24px;">Ce message a ete transmis via Humlinker. Vous ne pouvez pas repondre directement a cet email.</p>' +
          '</div>',
      });
      this.logger.log('Humlinker message sent to ' + to);
    } catch (error) {
      this.logger.error('Failed to send humlinker message to ' + to, error);
      throw error;
    }
  }

  /**
   * Envoie un code OTP a l'adresse email fournie.
   */
  async sendOtp(email: string, code: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.config.mail.from,
        to: email,
        subject: 'Votre code de verification Humlinker',
        text: 'Votre code de verification est : ' + code + '\n\nCe code expire dans 5 minutes.',
        html:
          '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;">' +
          '<h2 style="color:#333;">Verification de votre email</h2>' +
          '<p>Votre code de verification Humlinker est :</p>' +
          '<div style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#4F46E5;padding:16px 0;">' + code + '</div>' +
          '<p style="color:#666;font-size:13px;">Ce code expire dans <strong>5 minutes</strong>.</p>' +
          '</div>',
      });
      this.logger.log('OTP email sent to ' + email);
    } catch (error) {
      this.logger.error('Failed to send OTP email to ' + email, error);
      throw error;
    }
  }
}
