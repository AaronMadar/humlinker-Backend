import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { FakeRedisService } from '@/redis/redis.service.fake';
import type { RedisService } from '@/redis/redis.service';
import type { MailService } from '@/integrations/mail/mail.service';
import type { SmsService } from '@/integrations/sms/sms.service';
import { OtpService } from './otp.service';

describe('OtpService', () => {
  let redis: FakeRedisService;
  let mail: { sendOtp: jest.Mock };
  let sms: { sendOtp: jest.Mock };
  let service: OtpService;

  const PHONE = '+33600000000';
  const EMAIL = 'test@example.com';

  beforeEach(() => {
    redis = new FakeRedisService();
    mail = { sendOtp: jest.fn().mockResolvedValue(undefined) };
    sms = { sendOtp: jest.fn().mockResolvedValue(undefined) };
    service = new OtpService(
      redis as unknown as RedisService,
      mail as unknown as MailService,
      sms as unknown as SmsService,
    );
  });

  const lastSmsCode = () =>
    sms.sendOtp.mock.calls[sms.sendOtp.mock.calls.length - 1][1] as string;

  it('génère un code à 6 chiffres', async () => {
    await service.sendPhoneOtp(PHONE);
    expect(lastSmsCode()).toMatch(/^\d{6}$/);
  });

  it('impose 60 s entre deux envois vers le même numéro', async () => {
    await service.sendPhoneOtp(PHONE);
    await expect(service.sendPhoneOtp(PHONE)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(sms.sendOtp).toHaveBeenCalledTimes(1);

    redis.advance(61);
    await service.sendPhoneOtp(PHONE);
    expect(sms.sendOtp).toHaveBeenCalledTimes(2);
  });

  it('plafonne à 3 SMS par heure pour un même numéro (anti SMS pumping)', async () => {
    for (let i = 0; i < 3; i++) {
      await service.sendPhoneOtp(PHONE);
      redis.advance(61);
    }
    await expect(service.sendPhoneOtp(PHONE)).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(sms.sendOtp).toHaveBeenCalledTimes(3);
  });

  it('valide le bon code puis pose le flag verified', async () => {
    await service.sendPhoneOtp(PHONE);
    await service.verifyOtp(PHONE, lastSmsCode(), 'phone');
    expect(await redis.exists(`verified:phone:${PHONE}`)).toBe(true);
  });

  it('invalide le code après 5 essais incorrects (anti brute-force)', async () => {
    await service.sendEmailOtp(EMAIL);
    const goodCode = mail.sendOtp.mock.calls[0][1] as string;
    const wrong = goodCode === '000000' ? '111111' : '000000';

    for (let i = 0; i < 4; i++) {
      await expect(service.verifyOtp(EMAIL, wrong, 'email')).rejects.toThrow(
        /reste/,
      );
    }
    await expect(service.verifyOtp(EMAIL, wrong, 'email')).rejects.toThrow(
      /Trop de tentatives/,
    );

    // Même le bon code ne passe plus : il faut en redemander un
    await expect(
      service.verifyOtp(EMAIL, goodCode, 'email'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await redis.exists(`verified:email:${EMAIL}`)).toBe(false);
  });
});
