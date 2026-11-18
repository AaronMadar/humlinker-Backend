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
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomInt, timingSafeEqual } from 'crypto';
import { MailService } from '@/integrations/mail/mail.service';
import { SmsService } from '@/integrations/sms/sms.service';
import { RedisService } from '@/redis/redis.service';
import { QuotaService } from '@/modules/billing/quota.service';

// Durée de vie du code OTP en secondes (5 minutes)
const OTP_TTL_SECONDS = 5 * 60;

// Durée de vie du flag "vérifié" en secondes (15 minutes)
// L'utilisateur a 15 min pour finaliser son inscription après vérification
const VERIFIED_TTL_SECONDS = 15 * 60;

// Longueur du code OTP
const OTP_LENGTH = 6;

/** Nombre d'essais de vérification autorisés par code envoyé. */
const OTP_MAX_ATTEMPTS = 5;

/** Délai minimum entre deux envois vers la même cible. */
const OTP_RESEND_COOLDOWN_SECONDS = 60;

/** Plafond d'envois par cible (anti SMS pumping / spam email). */
const OTP_MAX_SENDS_PER_HOUR = { phone: 3, email: 5 } as const;
const OTP_MAX_SENDS_PER_DAY = { phone: 6, email: 15 } as const;

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly mailService: MailService,
    private readonly smsService: SmsService,
    private readonly quotaService: QuotaService,
  ) {}

  // ─── Génération ────────────────────────────────────────────────────────────

  /**
   * Génère un code numérique aléatoire à 6 chiffres.
   * Padding avec zéros pour toujours avoir 6 chiffres (ex: 000712).
   */
  private generateCode(): string {
    // randomInt = générateur cryptographiquement sûr (contrairement à Math.random)
    return randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, '0');
  }

  // ─── Clés Redis ────────────────────────────────────────────────────────────

  private otpKey(type: 'email' | 'phone', target: string): string {
    return `otp:${type}:${target}`;
  }

  private verifiedKey(type: 'email' | 'phone', target: string): string {
    return `verified:${type}:${target}`;
  }

  private attemptsKey(type: 'email' | 'phone', target: string): string {
    return `otp:attempts:${type}:${target}`;
  }

  /**
   * Vérifie et consomme le droit d'envoyer un OTP à une cible :
   * cooldown entre deux envois + plafonds horaire et journalier.
   */
  private async assertCanSend(type: 'email' | 'phone', target: string): Promise<void> {
    const cooldownKey = `otp:cooldown:${type}:${target}`;
    const acquired = await this.redis.setIfAbsent(cooldownKey, '1', OTP_RESEND_COOLDOWN_SECONDS);
    if (!acquired) {
      const ttl = await this.redis.ttl(cooldownKey);
      throw new HttpException(
        `Veuillez patienter ${ttl || OTP_RESEND_COOLDOWN_SECONDS} s avant de demander un nouveau code.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const hour = await this.redis.incrWithTtl(`otp:sends:h:${type}:${target}`, 60 * 60);
    const day = await this.redis.incrWithTtl(`otp:sends:d:${type}:${target}`, 24 * 60 * 60);
    if (hour.count > OTP_MAX_SENDS_PER_HOUR[type] || day.count > OTP_MAX_SENDS_PER_DAY[type]) {
      this.logger.warn(`Plafond d'envoi OTP atteint pour ${type}:${target}`);
      throw new HttpException(
        'Trop de codes demandés pour cette adresse ou ce numéro. Réessayez plus tard.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async storeCode(type: 'email' | 'phone', target: string, code: string): Promise<void> {
    await this.redis.set(this.otpKey(type, target), code, OTP_TTL_SECONDS);
    await this.redis.del(this.attemptsKey(type, target));
  }

  /** Comparaison en temps constant (évite les attaques par mesure de temps). */
  private codesMatch(expected: string, received: string): boolean {
    const a = Buffer.from(expected);
    const b = Buffer.from(received);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  // ─── Envoi ─────────────────────────────────────────────────────────────────

  /**
   * Génère un OTP, le stocke dans Redis et l'envoie par email.
   * Écrase un éventuel OTP précédent (nouvel envoi = nouveau code).
   */
  async sendEmailOtp(email: string): Promise<void> {
    await this.assertCanSend('email', email);
    const code = this.generateCode();
    await this.storeCode('email', email, code);
    await this.mailService.sendOtp(email, code);
    this.logger.log(`Email OTP sent to ${email}`);
  }

  /**
   * Génère un OTP, le stocke dans Redis et l'envoie par SMS via Twilio.
   */
  async sendPhoneOtp(phoneNumber: string): Promise<void> {
    await this.assertCanSend('phone', phoneNumber);
    // Disjoncteur global : plafond de SMS/jour pour toute la plateforme
    await this.quotaService.consumeSms();
    const code = this.generateCode();
    await this.storeCode('phone', phoneNumber, code);
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

    if (!this.codesMatch(storedCode, code.trim())) {
      const { count } = await this.redis.incrWithTtl(this.attemptsKey(type, target), OTP_TTL_SECONDS);
      if (count >= OTP_MAX_ATTEMPTS) {
        // Trop d'essais → le code est invalidé, il faut en redemander un
        await this.redis.del(this.otpKey(type, target));
        await this.redis.del(this.attemptsKey(type, target));
        this.logger.warn(`OTP invalidé après ${count} essais pour ${type}:${target}`);
        throw new BadRequestException(
          'Trop de tentatives. Ce code est désormais invalide, veuillez en demander un nouveau.',
        );
      }
      throw new BadRequestException(
        `Code incorrect. Il vous reste ${OTP_MAX_ATTEMPTS - count} tentative(s).`,
      );
    }

    // Code correct : on supprime le code OTP et on pose le flag "verified"
    await this.redis.del(this.otpKey(type, target));
    await this.redis.del(this.attemptsKey(type, target));
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
