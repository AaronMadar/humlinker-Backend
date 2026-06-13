/**
 * OtpService
 *
 * Gère tout le cycle de vie des codes OTP utilisés pour vérifier
 * l'email et le numéro de téléphone lors de l'inscription.
 *
 * ─── Flow complet d'une vérification ───────────────────────────────────────
 *
 * 1. Front appelle POST /auth/send-otp/email  (ou /phone)
 *    → sendEmailOtp() / sendPhoneOtp()
 *    → génère un code à 6 chiffres
 *    → stocke dans Redis : otp:email:{email} = "123456"  TTL 5 min
 *    → envoie le code par email (MailService) ou SMS (SmsService)
 *
 * 2. Front appelle POST /auth/verify-otp  avec { target, code, type }
 *    → verifyOtp()
 *    → lit Redis : otp:email:{email}
 *    → compare le code → si OK : supprime la clé OTP
 *    → stocke dans Redis : verified:email:{email} = "1"  TTL 15 min
 *
 * 3. Front appelle POST /auth/register
 *    → AuthService appelle checkBothVerified()
 *    → vérifie que verified:email:{email} ET verified:phone:{phone} existent
 *    → si oui : crée le user en DB, supprime les flags Redis
 *    → si non : BadRequestException (protection contre les appels directs API)
 *
 * ───────────────────────────────────────────────────────────────────────────
 */
import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { MailService } from '@/integrations/mail/mail.service';
import { SmsService } from '@/integrations/sms/sms.service';
import { RedisService } from '@/redis/redis.service';

// Durée de vie du code OTP en secondes (5 minutes)
const OTP_TTL_SECONDS = 5 * 60;

// Durée de vie du flag "vérifié" en secondes (15 minutes)
// L'utilisateur a 15 min pour finaliser son inscription après vérification
const VERIFIED_TTL_SECONDS = 15 * 60;

// Longueur du code OTP
const OTP_LENGTH = 6;

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly mailService: MailService,
    private readonly smsService: SmsService,
  ) {}

  // ─── Génération ────────────────────────────────────────────────────────────

  /**
   * Génère un code numérique aléatoire à 6 chiffres.
   * Padding avec zéros pour toujours avoir 6 chiffres (ex: 000712).
   */
  private generateCode(): string {
    const max = Math.pow(10, OTP_LENGTH);
    const code = Math.floor(Math.random() * max);
    return code.toString().padStart(OTP_LENGTH, '0');
  }

  // ─── Clés Redis ────────────────────────────────────────────────────────────

  private otpKey(type: 'email' | 'phone', target: string): string {
    return `otp:${type}:${target}`;
  }

  private verifiedKey(type: 'email' | 'phone', target: string): string {
    return `verified:${type}:${target}`;
  }

  // ─── Envoi ─────────────────────────────────────────────────────────────────

  /**
   * Génère un OTP, le stocke dans Redis et l'envoie par email.
   * Écrase un éventuel OTP précédent (nouvel envoi = nouveau code).
   */
  async sendEmailOtp(email: string): Promise<void> {
    const code = this.generateCode();
    await this.redis.set(this.otpKey('email', email), code, OTP_TTL_SECONDS);
    await this.mailService.sendOtp(email, code);
    this.logger.log(`Email OTP sent to ${email}`);
  }

  /**
   * Génère un OTP, le stocke dans Redis et l'envoie par SMS via Twilio.
   */
  async sendPhoneOtp(phoneNumber: string): Promise<void> {
    const code = this.generateCode();
    await this.redis.set(this.otpKey('phone', phoneNumber), code, OTP_TTL_SECONDS);
    await this.smsService.sendOtp(phoneNumber, code);
    this.logger.log(`Phone OTP sent to ${phoneNumber}`);
  }

  // ─── Vérification ──────────────────────────────────────────────────────────

  /**
   * Vérifie un code OTP pour un email ou un téléphone.
   *
   * - Si le code est correct → supprime la clé OTP → stocke le flag "verified"
   * - Si le code est incorrect ou expiré → BadRequestException
   */
  async verifyOtp(
    target: string,
    code: string,
    type: 'email' | 'phone',
  ): Promise<void> {
    const storedCode = await this.redis.get(this.otpKey(type, target));

    if (!storedCode) {
      throw new BadRequestException(
        'Code expiré ou invalide. Veuillez en demander un nouveau.',
      );
    }

    if (storedCode !== code.trim()) {
      throw new BadRequestException('Code incorrect.');
    }

    // Code correct : on supprime le code OTP et on pose le flag "verified"
    await this.redis.del(this.otpKey(type, target));
    await this.redis.set(
      this.verifiedKey(type, target),
      '1',
      VERIFIED_TTL_SECONDS,
    );

    this.logger.log(`${type} verified for ${target}`);
  }

  // ─── Contrôle côté register ────────────────────────────────────────────────

  /**
   * Vérifie que l'email ET le téléphone ont bien été vérifiés (flags Redis présents).
   * Appelé dans AuthService.register() pour bloquer les appels directs API (Postman, curl...).
   *
   * Si les deux flags existent → les supprime et retourne true
   * Sinon → lance une BadRequestException
   */
  async checkBothVerifiedAndClear(
    email: string,
    phoneNumber: string,
  ): Promise<void> {
    const emailVerified = await this.redis.exists(
      this.verifiedKey('email', email),
    );
    const phoneVerified = await this.redis.exists(
      this.verifiedKey('phone', phoneNumber),
    );

    if (!emailVerified || !phoneVerified) {
      throw new BadRequestException(
        "L'email et le numéro de téléphone doivent être vérifiés avant l'inscription.",
      );
    }

    // Nettoyage des flags Redis après validation
    await this.redis.del(this.verifiedKey('email', email));
    await this.redis.del(this.verifiedKey('phone', phoneNumber));
  }

  /**
   * Vérifie que le téléphone a bien été vérifié (pour le flow Google — complétion de profil).
   * Appelé dans AuthService.completeGoogleProfile().
   */
  async checkPhoneVerifiedAndClear(phoneNumber: string): Promise<void> {
    const phoneVerified = await this.redis.exists(
      this.verifiedKey('phone', phoneNumber),
    );

    if (!phoneVerified) {
      throw new BadRequestException(
        'Le numéro de téléphone doit être vérifié avant de finaliser le profil.',
      );
    }

    await this.redis.del(this.verifiedKey('phone', phoneNumber));
  }

  /**
   * Vérifie qu'un email OU un téléphone a été vérifié.
   * Utilisé pour le flow reset password et le changement d'email/téléphone depuis le profil.
   *
   * - type 'email' → vérifie verified:email:{identifier}
   * - type 'phone' → vérifie verified:phone:{identifier}
   *
   * Si le flag existe → le supprime (usage unique)
   * Sinon → BadRequestException
   */
  async checkSingleVerifiedAndClear(
    identifier: string,
    type: 'email' | 'phone',
  ): Promise<void> {
    const isVerified = await this.redis.exists(
      this.verifiedKey(type, identifier),
    );

    if (!isVerified) {
      throw new BadRequestException(
        `${type === 'email' ? "L'email" : 'Le téléphone'} doit être vérifié avant cette action.`,
      );
    }

    await this.redis.del(this.verifiedKey(type, identifier));
  }
}
