import { JwtService } from '@nestjs/jwt';
import { FakeRedisService } from '@/redis/redis.service.fake';
import { REFRESH_RACE_GRACE_SEC, SESSIONS_REVOKED, SessionService } from './session.service';
import type { JwtPayload } from '../interfaces/jwt-payload.interface';

/**
 * Tests unitaires (Redis en mémoire, Prisma mocké) : rotation, réutilisation,
 * course entre onglets, logout, logout-all.
 */
describe('SessionService', () => {
  const SECRET = 'test-secret';
  let redis: FakeRedisService;
  let jwt: JwtService;
  let users: Map<string, { id: string; role: 'user'; tokenVersion: number; deletedAt: Date | null }>;
  let events: { emit: jest.Mock };
  let service: SessionService;
  let nowMs: number;

  beforeEach(() => {
    nowMs = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    redis = new FakeRedisService();
    jwt = new JwtService({ secret: SECRET });
    users = new Map([['u1', { id: 'u1', role: 'user', tokenVersion: 0, deletedAt: null }]]);
    events = { emit: jest.fn() };
    const prisma = {
      user: {
        findFirst: jest.fn(async ({ where }: { where: { id: string } }) => {
          const u = users.get(where.id);
          return u && !u.deletedAt ? u : null;
        }),
        update: jest.fn(async ({ where }: { where: { id: string } }) => {
          const u = users.get(where.id)!;
          u.tokenVersion += 1;
          return { tokenVersion: u.tokenVersion };
        }),
      },
    };
    const config = { jwt: { accessExpiresIn: '15m', refreshTtlDays: 30 } };
    service = new SessionService(
      jwt,
      redis as never,
      prisma as never,
      events as never,
      config as never,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  const user = () => ({ _id: 'u1', role: 'user' as const, tokenVersion: users.get('u1')!.tokenVersion });
  const decode = (token: string) => jwt.verify<JwtPayload & { exp: number; iat: number }>(token);

  it('émet un jeton d’accès de 15 min portant la session et la version', async () => {
    const { token, refreshToken } = await service.createSession(user());
    const payload = decode(token);
    expect(payload).toMatchObject({ userId: 'u1', role: 'user', tv: 0 });
    expect(payload.exp - payload.iat).toBe(15 * 60);
    expect(refreshToken.startsWith(`${payload.sid}.`)).toBe(true);
    // Seul le hash du secret est stocké
    const stored = await redis.get(`auth:rt:${payload.sid}`);
    expect(stored).not.toContain(refreshToken.split('.')[1]);
    await expect(service.isAccessPayloadValid(payload)).resolves.toBe(true);
  });

  it('rotation : le nouveau jeton fonctionne, l’ancien ne sert plus', async () => {
    const first = await service.createSession(user());
    const second = await service.refresh(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(decode(second.token).sid).toBe(decode(first.token).sid);
    const third = await service.refresh(second.refreshToken);
    expect(third.refreshToken).not.toBe(second.refreshToken);
  });

  it('réutilisation d’un ancien jeton → toute la famille est révoquée', async () => {
    const first = await service.createSession(user());
    const second = await service.refresh(first.refreshToken);
    nowMs += (REFRESH_RACE_GRACE_SEC + 1) * 1000; // hors fenêtre de course

    await expect(service.refresh(first.refreshToken)).rejects.toMatchObject({
      response: { code: 'refresh_reused' },
    });
    // Le jeton légitime (le plus récent) est mort aussi
    await expect(service.refresh(second.refreshToken)).rejects.toMatchObject({
      response: { code: 'refresh_invalid' },
    });
    // Et les jetons d'accès de la session sont refusés
    await expect(service.isAccessPayloadValid(decode(second.token))).resolves.toBe(false);
  });

  it('deux onglets qui rafraîchissent en même temps : refus sans révocation', async () => {
    const first = await service.createSession(user());
    const second = await service.refresh(first.refreshToken);
    nowMs += 5_000;
    await expect(service.refresh(first.refreshToken)).rejects.toMatchObject({
      response: { code: 'refresh_race' },
    });
    // La session continue avec le jeton déposé par l'autre onglet
    await expect(service.refresh(second.refreshToken)).resolves.toHaveProperty('token');
  });

  it('refuse un jeton forgé ou mal formé sans révoquer quand la session est inconnue', async () => {
    await expect(service.refresh('n-importe-quoi')).rejects.toMatchObject({
      response: { code: 'refresh_invalid' },
    });
    await expect(service.refresh('sid-inconnu.secret')).rejects.toMatchObject({
      response: { code: 'refresh_invalid' },
    });
  });

  it('refuse le rafraîchissement d’un compte supprimé', async () => {
    const first = await service.createSession(user());
    users.get('u1')!.deletedAt = new Date();
    await expect(service.refresh(first.refreshToken)).rejects.toMatchObject({
      response: { code: 'refresh_invalid' },
    });
  });

  it('logout révoque seulement la session courante', async () => {
    const a = await service.createSession(user());
    const b = await service.createSession(user());
    await service.logout(a.refreshToken);
    await expect(service.refresh(a.refreshToken)).rejects.toBeDefined();
    await expect(service.isAccessPayloadValid(decode(a.token))).resolves.toBe(false);
    await expect(service.isAccessPayloadValid(decode(b.token))).resolves.toBe(true);
    await expect(service.refresh(b.refreshToken)).resolves.toHaveProperty('token');
    // Idempotent
    await expect(service.logout(a.refreshToken)).resolves.toBeUndefined();
    await expect(service.logout('garbage')).resolves.toBeUndefined();
  });

  it('logout-all : toutes les sessions et tous les jetons d’accès invalidés', async () => {
    const a = await service.createSession(user());
    const b = await service.createSession(user());
    const legacy = jwt.sign({ userId: 'u1', role: 'user' }); // ancien jeton sans session

    await expect(service.isAccessPayloadValid(decode(legacy))).resolves.toBe(true);
    await service.revokeAll('u1');

    for (const s of [a, b]) {
      await expect(service.refresh(s.refreshToken)).rejects.toBeDefined();
      await expect(service.isAccessPayloadValid(decode(s.token))).resolves.toBe(false);
    }
    await expect(service.isAccessPayloadValid(decode(legacy))).resolves.toBe(false);
    expect(events.emit).toHaveBeenCalledWith(SESSIONS_REVOKED, { userId: 'u1', exceptSid: null });
  });

  it('revokeAll avec exceptSid garde la session courante (changement de mot de passe)', async () => {
    const current = await service.createSession(user());
    const other = await service.createSession(user());
    const sid = decode(current.token).sid!;

    const version = await service.revokeAll('u1', { exceptSid: sid });
    expect(version).toBe(1);

    // L'ancien jeton d'accès (ancienne version) est refusé, le nouveau accepté
    await expect(service.isAccessPayloadValid(decode(current.token))).resolves.toBe(false);
    const fresh = service.signAccessToken({ ...user(), tokenVersion: version }, sid);
    await expect(service.isAccessPayloadValid(decode(fresh))).resolves.toBe(true);
    // La session courante se rafraîchit encore ; l'autre non
    await expect(service.refresh(current.refreshToken)).resolves.toHaveProperty('token');
    await expect(service.refresh(other.refreshToken)).rejects.toBeDefined();
  });

  it('un jeton rafraîchi après logout-all porte la nouvelle version', async () => {
    const current = await service.createSession(user());
    const sid = decode(current.token).sid!;
    await service.revokeAll('u1', { exceptSid: sid });
    const next = await service.refresh(current.refreshToken);
    expect(decode(next.token).tv).toBe(1);
    await expect(service.isAccessPayloadValid(decode(next.token))).resolves.toBe(true);
  });
});
