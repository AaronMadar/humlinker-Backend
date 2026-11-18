import { HttpStatus, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FakeRedisService } from '@/redis/redis.service.fake';
import type { RedisService } from '@/redis/redis.service';
import { RateLimitGuard } from './rate-limit.guard';
import {
  RATE_LIMIT_KEY,
  SKIP_RATE_LIMIT_KEY,
  type RateLimitRule,
} from './rate-limit.decorator';

class TestController {
  handler() {}
}

function makeContext(
  opts: { ip?: string; userId?: string; headers?: Record<string, string> } = {},
) {
  const res = {
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
  };
  const req = {
    ip: opts.ip ?? '1.2.3.4',
    user: opts.userId ? { userId: opts.userId } : undefined,
  };
  const ctx = {
    getType: () => 'http',
    getHandler: () => TestController.prototype.handler,
    getClass: () => TestController,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { ctx, res };
}

describe('RateLimitGuard', () => {
  let redis: FakeRedisService;
  let reflector: Reflector;
  let guard: RateLimitGuard;

  const withRules = (rules: RateLimitRule[] | undefined, skip = false) => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: unknown) => {
        if (key === RATE_LIMIT_KEY) return rules;
        if (key === SKIP_RATE_LIMIT_KEY) return skip;
        return undefined;
      });
  };

  beforeEach(() => {
    redis = new FakeRedisService();
    reflector = new Reflector();
    guard = new RateLimitGuard(reflector, redis as unknown as RedisService);
  });

  it('bloque au-delà de la limite de la route avec 429 + Retry-After', async () => {
    withRules([{ name: 't', by: 'ip', limit: 2, windowSec: 60 }]);
    const { ctx, res } = makeContext();

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(res.headers['Retry-After']).toBe('60');
  });

  it('repart à zéro après la fenêtre', async () => {
    withRules([{ name: 't', by: 'ip', limit: 1, windowSec: 60 }]);
    const { ctx } = makeContext();
    await guard.canActivate(ctx);
    await expect(guard.canActivate(ctx)).rejects.toBeDefined();
    redis.advance(61);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("compte par utilisateur quand by='user' (deux users sur la même IP sont indépendants)", async () => {
    withRules([{ name: 't', by: 'user', limit: 1, windowSec: 60 }]);
    await guard.canActivate(makeContext({ userId: 'a' }).ctx);
    await expect(
      guard.canActivate(makeContext({ userId: 'b' }).ctx),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(makeContext({ userId: 'a' }).ctx),
    ).rejects.toBeDefined();
  });

  it('ignore les routes marquées @SkipRateLimit', async () => {
    withRules([{ name: 't', by: 'ip', limit: 0, windowSec: 60 }], true);
    await expect(guard.canActivate(makeContext().ctx)).resolves.toBe(true);
  });

  it('laisse passer si Redis est indisponible (fail-open)', async () => {
    withRules([{ name: 't', by: 'ip', limit: 1, windowSec: 60 }]);
    jest.spyOn(redis, 'incrWithTtl').mockRejectedValue(new Error('down'));
    await expect(guard.canActivate(makeContext().ctx)).resolves.toBe(true);
  });
});
