import type { RedisService } from '@/redis/redis.service';
import type { UsersRepository } from '../users/repositories';
import type { OtpService } from './services/otp.service';
import type { SessionService } from './sessions/session.service';
import { AuthService } from './auth.service';

describe('AuthService — sessions', () => {
  function setup() {
    const user = { _id: 'u1', role: 'user', tokenVersion: 0, phoneNumber: '+33600000000' };
    const repo = {
      findByEmail: jest.fn(async () => user),
      update: jest.fn(async () => user),
    } as unknown as UsersRepository;
    const otp = { checkSingleVerifiedAndClear: jest.fn(async () => undefined) } as unknown as OtpService;
    const sessions = {
      revokeAll: jest.fn(async () => 1),
      isSessionActive: jest.fn(async (sid: string) => sid === 'live'),
      signAccessToken: jest.fn(() => 'access'),
      createSession: jest.fn(async () => ({ token: 'new-access', refreshToken: 'sid.secret' })),
    };
    const service = new AuthService(
      repo,
      { google: { clientId: 'x' } } as never,
      sessions as unknown as SessionService,
      otp,
      {} as RedisService,
    );
    return { service, sessions, repo };
  }

  it('réinitialisation du mot de passe → toutes les sessions révoquées', async () => {
    const { service, sessions } = setup();
    await service.resetPassword('a@b.com', 'email', 'NouveauMdp1!');
    expect(sessions.revokeAll).toHaveBeenCalledWith('u1');
  });

  it('logout-all délègue à revokeAll', async () => {
    const { service, sessions } = setup();
    await service.logoutAll('u1');
    expect(sessions.revokeAll).toHaveBeenCalledWith('u1');
  });
});
