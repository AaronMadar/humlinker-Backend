import { HttpStatus, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { JwtService } from '@nestjs/jwt';
import { FakeRedisService } from '@/redis/redis.service.fake';
import type { RedisService } from '@/redis/redis.service';
import type { UsersRepository } from '../users/repositories';
import type { OtpService } from './services/otp.service';
import { AuthService } from './auth.service';

describe('AuthService.login — anti brute-force', () => {
  const PASSWORD = 'BonMotDePasse1!';
  let redis: FakeRedisService;
  let service: AuthService;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const user = { _id: 'u1', role: 'user', email: 'a@b.com', passwordHash };
    const repo = {
      findByEmailOrPhone: jest.fn(async (id: string) =>
        id === 'a@b.com' ? user : null,
      ),
      updateLastLoginAt: jest.fn(async () => user),
    } as unknown as UsersRepository;
    const config = { google: { clientId: 'x' } } as never;
    const jwt = { sign: jest.fn(() => 'token') } as unknown as JwtService;

    redis = new FakeRedisService();
    service = new AuthService(
      repo,
      config,
      jwt,
      {} as OtpService,
      redis as unknown as RedisService,
    );
  });

  it('bloque le compte 15 min après 5 mots de passe incorrects', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(
        service.login({ identifier: 'a@b.com', password: 'mauvais-mdp' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }

    // Même le bon mot de passe est refusé pendant le blocage
    await expect(
      service.login({ identifier: 'a@b.com', password: PASSWORD }),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });

    redis.advance(15 * 60 + 1);
    await expect(
      service.login({ identifier: 'a@b.com', password: PASSWORD }),
    ).resolves.toMatchObject({
      token: 'token',
    });
  });

  it('renvoie la même erreur que le compte existe ou non (anti-énumération)', async () => {
    await expect(
      service.login({ identifier: 'inconnu@b.com', password: 'x'.repeat(8) }),
    ).rejects.toThrow('Identifiants invalides.');
  });
});
