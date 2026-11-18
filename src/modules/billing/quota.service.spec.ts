import { HttpStatus } from '@nestjs/common';
import { FakeRedisService } from '@/redis/redis.service.fake';
import type { RedisService } from '@/redis/redis.service';
import type { PrismaService } from '@/database';
import type { MailService } from '@/integrations/mail/mail.service';
import { QuotaService } from './quota.service';
import { COSTS, GLOBAL_LIMITS, PLANS } from './plans.config';
import {
  HUMLINKER_LIMIT_REACHED,
  MESSAGE_TOO_LONG,
  QUOTA_EXCEEDED,
  SERVICE_BUDGET_EXCEEDED,
} from './quota.exceptions';

/** Faux Prisma : utilisateurs, usage_records et humlinkers en mémoire. */
function makePrisma() {
  const users = new Map<string, any>();
  const records: any[] = [];
  const humlinkers: any[] = [];
  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where }) => users.get(where.id) ?? null),
    },
    usageRecord: {
      count: jest.fn(
        async ({ where }) =>
          records.filter(
            (r) =>
              r.userId === where.userId &&
              r.type === where.type &&
              r.createdAt >= where.createdAt.gte,
          ).length,
      ),
      create: jest.fn(async ({ data }) => {
        records.push({ createdAt: new Date(), ...data });
        return data;
      }),
    },
    humlinker: {
      count: jest.fn(
        async ({ where }) =>
          humlinkers.filter(
            (h) =>
              h.senderId === where.senderId &&
              h.isInitiator === where.isInitiator &&
              where.status.in.includes(h.status),
          ).length,
      ),
    },
  };
  return { prisma, users, records, humlinkers };
}

describe('QuotaService', () => {
  let db: ReturnType<typeof makePrisma>;
  let redis: FakeRedisService;
  let mail: { sendAdminAlert: jest.Mock };
  let service: QuotaService;

  const addUser = (id: string, extra: Record<string, unknown> = {}) =>
    db.users.set(id, {
      id,
      role: 'user',
      plan: 'free',
      planExpiresAt: null,
      ...extra,
    });
  const addUsage = (
    userId: string,
    type: string,
    n: number,
    createdAt = new Date(),
  ) => {
    for (let i = 0; i < n; i++) db.records.push({ userId, type, createdAt });
  };

  beforeEach(() => {
    db = makePrisma();
    redis = new FakeRedisService();
    mail = { sendAdminAlert: jest.fn() };
    service = new QuotaService(
      db.prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      mail as unknown as MailService,
    );
  });

  it('autorise tant que la limite du jour n’est pas atteinte', async () => {
    addUser('u');
    addUsage(
      'u',
      'ai_reformulation',
      PLANS.free.quotas.ai_reformulation.day! - 1,
    );
    await expect(
      service.assertCanUse('u', 'ai_reformulation'),
    ).resolves.toBeUndefined();
  });

  it('bloque en 402 QUOTA_EXCEEDED à la limite du jour (offre gratuite)', async () => {
    addUser('u');
    addUsage('u', 'ai_reformulation', PLANS.free.quotas.ai_reformulation.day!);
    await expect(
      service.assertCanUse('u', 'ai_reformulation'),
    ).rejects.toMatchObject({
      status: HttpStatus.PAYMENT_REQUIRED,
      response: {
        code: QUOTA_EXCEEDED,
        details: { period: 'day', plan: 'free' },
      },
    });
  });

  it('bloque à la limite du mois même si le jour est libre', async () => {
    addUser('u');
    const earlierThisMonth = new Date();
    earlierThisMonth.setUTCDate(1);
    earlierThisMonth.setUTCHours(0, 0, 1, 0);
    // Si on est le 1er du mois, ces usages tombent aujourd'hui : le test reste valide (limite atteinte)
    addUsage(
      'u',
      'ai_reformulation',
      PLANS.free.quotas.ai_reformulation.month!,
      earlierThisMonth,
    );
    await expect(
      service.assertCanUse('u', 'ai_reformulation'),
    ).rejects.toMatchObject({
      response: { code: QUOTA_EXCEEDED },
    });
  });

  it('les réponses (ai_reply) ont leur propre quota, indépendant des reformulations', async () => {
    addUser('u');
    addUsage('u', 'ai_reformulation', PLANS.free.quotas.ai_reformulation.day!);
    await expect(
      service.assertCanUse('u', 'ai_reply'),
    ).resolves.toBeUndefined();
  });

  it('applique les limites Pro à un utilisateur Pro', async () => {
    addUser('u', { plan: 'pro' });
    addUsage('u', 'ai_reformulation', PLANS.free.quotas.ai_reformulation.day!);
    await expect(
      service.assertCanUse('u', 'ai_reformulation'),
    ).resolves.toBeUndefined();
  });

  it('un Pro expiré repasse aux limites gratuites', async () => {
    addUser('u', { plan: 'pro', planExpiresAt: new Date(Date.now() - 1000) });
    addUsage('u', 'ai_reformulation', PLANS.free.quotas.ai_reformulation.day!);
    await expect(
      service.assertCanUse('u', 'ai_reformulation'),
    ).rejects.toMatchObject({
      response: { code: QUOTA_EXCEEDED, details: { plan: 'free' } },
    });
  });

  it('les administrateurs ne sont pas limités', async () => {
    addUser('admin', { role: 'admin' });
    addUsage('admin', 'ai_reformulation', 10_000);
    await expect(
      service.assertCanUse('admin', 'ai_reformulation'),
    ).resolves.toBeUndefined();
  });

  it('refuse un message plus long que la limite de l’offre', async () => {
    addUser('u');
    await expect(
      service.assertCanUse('u', 'ai_reformulation', {
        messageLength: PLANS.free.maxMessageLength + 1,
      }),
    ).rejects.toMatchObject({ response: { code: MESSAGE_TOO_LONG } });
  });

  it('limite les humlinkers actifs LANCÉS (les invitations reçues ne comptent pas)', async () => {
    addUser('u');
    const limit = PLANS.free.activeHumlinkers!;
    for (let i = 0; i < limit; i++) {
      db.humlinkers.push({
        senderId: 'u',
        isInitiator: true,
        status: 'active',
      });
    }
    db.humlinkers.push({ senderId: 'u', isInitiator: false, status: 'active' }); // reçu
    db.humlinkers.push({
      senderId: 'u',
      isInitiator: true,
      status: 'archived',
    }); // archivé
    await expect(service.assertCanCreateHumlinker('u')).rejects.toMatchObject({
      response: { code: HUMLINKER_LIMIT_REACHED, details: { used: limit } },
    });
  });

  it('enregistre le coût IA et coupe l’IA quand le budget global du jour est atteint', async () => {
    addUser('u');
    const budgetMicro = GLOBAL_LIMITS.dailyAiBudgetUsd * 1_000_000;
    // Un appel « énorme » qui consomme tout le budget
    const outputTokens = Math.ceil(budgetMicro / COSTS.aiOutputPerMillionUsd);
    await service.recordAi('u', 'ai_reformulation', 'h1', {
      inputTokens: 0,
      outputTokens,
    });

    expect(db.records[db.records.length - 1]).toMatchObject({
      type: 'ai_reformulation',
      outputTokens,
    });
    await expect(service.assertAiBudget()).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      response: { code: SERVICE_BUDGET_EXCEEDED },
    });
    await expect(service.assertAiBudget()).rejects.toBeDefined();
    expect(mail.sendAdminAlert).toHaveBeenCalledTimes(1); // une seule alerte par jour
  });

  it('coupe les SMS au-delà de la limite globale journalière', async () => {
    for (let i = 0; i < GLOBAL_LIMITS.dailySmsLimit; i++)
      await service.consumeSms();
    await expect(service.consumeSms()).rejects.toMatchObject({
      response: { code: SERVICE_BUDGET_EXCEEDED },
    });
    expect(db.records.filter((r) => r.type === 'sms_otp')).toHaveLength(
      GLOBAL_LIMITS.dailySmsLimit,
    );
  });

  it('getUsage renvoie offre, consommation et limites', async () => {
    addUser('u');
    addUsage('u', 'ai_reply', 4);
    const usage = await service.getUsage('u');
    expect(usage.plan).toBe('free');
    expect(usage.quotas.ai_reply.day).toMatchObject({
      used: 4,
      limit: PLANS.free.quotas.ai_reply.day,
    });
    expect(usage.activeHumlinkers.limit).toBe(PLANS.free.activeHumlinkers);
  });
});
