import { Inject, Injectable, Logger } from '@nestjs/common';
import twilio from 'twilio';
import { APP_CONFIG } from '@/config';
import configuration from '@/config/configuration';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly client: twilio.Twilio;

  constructor(
    @Inject(APP_CONFIG)
    private readonly config: ReturnType<typeof configuration>,
  ) {
    this.client = twilio(config.twilio.accountSid, config.twilio.authToken);
  }

  // ─── OTP ──────────────────────────────────────────────────────────────────

  async sendOtp(phoneNumber: string, code: string): Promise<void> {
    const body = `Votre code de verification Humlinker : ${code}. Valable 5 minutes.`;
    await this.client.messages.create({
      body,
      from: this.config.twilio.phoneNumber,
      to: phoneNumber,
    });
    this.logger.log(`SMS OTP sent to ${phoneNumber}`);
  }

  // ─── SMS simple ───────────────────────────────────────────────────────────

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
