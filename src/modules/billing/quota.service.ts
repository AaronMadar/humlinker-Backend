/**
 * QuotaService — limites par offre + disjoncteurs globaux + suivi des coûts.
 *
 * Source de vérité des compteurs : la table usage_records (PostgreSQL),
 * donc les quotas survivent à un redémarrage ou à une perte de Redis.
 * Redis ne sert qu'aux disjoncteurs globaux journaliers (budget IA, SMS),
 * qui doivent être rapides et partagés entre instances.
 *
 * Périodes : jour et mois calendaires en UTC.
 * Les administrateurs (role = admin) ne sont pas limités.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { UsageType } from '@prisma/client';
import { PrismaService } from '../../database';
import { RedisService } from '../../redis/redis.service';
import { MailService } from '../../integrations/mail/mail.service';
import type { PlanTier, User } from '../users/entities';
import {
  COSTS,
  GLOBAL_LIMITS,
  PLANS,
  aiCostMicroUsd,
  type PlanLimits,
  type QuotaPeriod,
  type QuotaType,
} from './plans.config';
import {
  HumlinkerLimitException,
  MessageTooLongException,
  QuotaExceededException,
  ServiceBudgetExceededException,
} from './quota.exceptions';

const TWO_DAYS = 2 * 24 * 60 * 60;

export interface PeriodUsage {
  used: number;
  limit: number | null;
  resetAt: string;
}

export interface UsageSummary {
  plan: PlanTier;
  planExpiresAt: string | null;
  unlimited: boolean;
  maxMessageLength: number;
  quotas: Record<QuotaType, Record<QuotaPeriod, PeriodUsage>>;
  activeHumlinkers: { used: number; limit: number | null };
  /** Abonnement Stripe (null si jamais abonné) */
  subscription: {
    status: string;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string | null;
  } | null;
}

type QuotaUser = Pick<
  User,
  | '_id'
  | 'role'
  | 'plan'
  | 'planExpiresAt'
  | 'subscriptionStatus'
  | 'cancelAtPeriodEnd'
  | 'currentPeriodStart'
  | 'currentPeriodEnd'
>;

@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
  ) {}

  // ─── Offre effective ──────────────────────────────────────────────────────

  /** Pro expiré → free. */
  effectivePlan(
    user: Pick<User, 'plan' | 'planExpiresAt'>,
    now = new Date(),
  ): PlanTier {
    if (
      user.plan === 'pro' &&
      user.planExpiresAt &&
      user.planExpiresAt <= now
    ) {
      return 'free';
    }
    return user.plan;
  }

  private isUnlimited(user: Pick<User, 'role'>): boolean {
    return user.role === 'admin';
  }

  private async loadUser(userId: string): Promise<QuotaUser> {
    const record = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        plan: true,
        planExpiresAt: true,
        subscriptionStatus: true,
        cancelAtPeriodEnd: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
      },
    });
    if (!record) throw new NotFoundException('Utilisateur introuvable.');
    const { id, ...rest } = record;
    return { _id: id, ...rest };
  }

  /**
   * Ancre des quotas mensuels : pour un Pro, le jour de son abonnement
   * (le quota repart chaque mois à cette date, y compris en formule annuelle).
   * Pour le gratuit : le 1er du mois.
   */
  private monthAnchor(user: QuotaUser, plan: PlanTier): Date | null {
    return plan === 'pro' ? user.currentPeriodStart : null;
  }

  // ─── Périodes ─────────────────────────────────────────────────────────────

  static periodBounds(
    period: QuotaPeriod,
    now = new Date(),
    monthAnchor: Date | null = null,
  ): { start: Date; resetAt: Date } {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    if (period === 'day') {
      const start = new Date(Date.UTC(y, m, now.getUTCDate()));
      return {
        start,
        resetAt: new Date(start.getTime() + 24 * 60 * 60 * 1000),
      };
    }
    if (monthAnchor && monthAnchor <= now) {
      // Mois glissant ancré sur la date d'abonnement (ex : le 18 de chaque mois)
      let months =
        (y - monthAnchor.getUTCFullYear()) * 12 +
        (m - monthAnchor.getUTCMonth());
      let start = QuotaService.addMonths(monthAnchor, months);
      if (start > now) start = QuotaService.addMonths(monthAnchor, --months);
      return {
        start,
        resetAt: QuotaService.addMonths(monthAnchor, months + 1),
      };
    }
    return {
      start: new Date(Date.UTC(y, m, 1)),
      resetAt: new Date(Date.UTC(y, m + 1, 1)),
    };
  }

  /** anchor + n mois, jour borné à la fin du mois (31 janv. + 1 mois = 28/29 févr.). */
  static addMonths(anchor: Date, n: number): Date {
    const y = anchor.getUTCFullYear();
    const m = anchor.getUTCMonth() + n;
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(
      Date.UTC(
        y,
        m,
        Math.min(anchor.getUTCDate(), lastDay),
        anchor.getUTCHours(),
        anchor.getUTCMinutes(),
        anchor.getUTCSeconds(),
      ),
    );
  }

  private static dayKey(now = new Date()): string {
    return now.toISOString().slice(0, 10);
  }

  private async countUsage(
    userId: string,
    type: QuotaType,
    since: Date,
  ): Promise<number> {
    return this.prisma.usageRecord.count({
      where: { userId, type, createdAt: { gte: since } },
    });
  }

  private async countActiveInitiatedHumlinkers(
    userId: string,
  ): Promise<number> {
    // Seuls les humlinkers LANCÉS par l'utilisateur comptent :
    // recevoir une invitation ne doit jamais être bloqué.
    return this.prisma.humlinker.count({
      where: {
        senderId: userId,
        isInitiator: true,
        status: { in: ['pending', 'active'] },
      },
    });
  }

  // ─── Vérifications (à appeler AVANT l'action coûteuse) ────────────────────

  /**
   * Lève une QuotaExceededException si l'utilisateur a épuisé ce quota
   * (jour ou mois). `messageLength` vérifie aussi la longueur max de l'offre.
   */
  async assertCanUse(
    userId: string,
    type: QuotaType,
    opts: { messageLength?: number } = {},
  ): Promise<void> {
    const user = await this.loadUser(userId);
    if (this.isUnlimited(user)) return;

    const plan = this.effectivePlan(user);
    const limits: PlanLimits = PLANS[plan];

    if (
      opts.messageLength !== undefined &&
      opts.messageLength > limits.maxMessageLength
    ) {
      throw new MessageTooLongException({
        limit: limits.maxMessageLength,
        length: opts.messageLength,
        plan,
      });
    }

    for (const period of ['day', 'month'] as const) {
      const limit = limits.quotas[type][period];
      if (limit === null) continue;
      const { start, resetAt } = QuotaService.periodBounds(
        period,
        new Date(),
        this.monthAnchor(user, plan),
      );
      const used = await this.countUsage(userId, type, start);
      if (used >= limit) {
        throw new QuotaExceededException({
          quota: type,
          period,
          limit,
          used,
          resetAt,
          plan,
        });
      }
    }
  }

  async assertCanCreateHumlinker(userId: string): Promise<void> {
    const user = await this.loadUser(userId);
    if (this.isUnlimited(user)) return;

    const plan = this.effectivePlan(user);
    const limit = PLANS[plan].activeHumlinkers;
    if (limit === null) return;

    const used = await this.countActiveInitiatedHumlinkers(userId);
    if (used >= limit) {
      throw new HumlinkerLimitException({ limit, used, plan });
    }
  }

  /** Disjoncteur global : budget IA journalier de toute la plateforme. */
  async assertAiBudget(): Promise<void> {
    const spentMicro = Number(
      (await this.safeRedis(() =>
        this.redis.get(`budget:ai:${QuotaService.dayKey()}`),
      )) ?? 0,
    );
    if (spentMicro >= GLOBAL_LIMITS.dailyAiBudgetUsd * 1_000_000) {
      await this.alertOnce(
        'ai-budget',
        'Budget IA journalier atteint',
        `Le budget IA de ${GLOBAL_LIMITS.dailyAiBudgetUsd} $ est atteint pour le ${QuotaService.dayKey()} UTC. ` +
          `Les reformulations sont suspendues jusqu'à minuit UTC. Ajustez GLOBAL_DAILY_AI_BUDGET_USD si besoin.`,
      );
      throw new ServiceBudgetExceededException();
    }
  }

  /**
   * Disjoncteur global SMS : à appeler juste avant chaque envoi de SMS OTP.
   * Compte l'envoi (Redis + usage_records).
   */
  async consumeSms(): Promise<void> {
    const result = await this.safeRedis(() =>
      this.redis.incrWithTtl(`budget:sms:${QuotaService.dayKey()}`, TWO_DAYS),
    );
    if (result && result.count > GLOBAL_LIMITS.dailySmsLimit) {
      await this.alertOnce(
        'sms-budget',
        'Limite journalière de SMS atteinte',
        `${GLOBAL_LIMITS.dailySmsLimit} SMS OTP envoyés le ${QuotaService.dayKey()} UTC. ` +
          `Envoi suspendu jusqu'à minuit UTC. Possible attaque de type SMS pumping : vérifiez les logs Twilio.`,
      );
      throw new ServiceBudgetExceededException();
    }
    await this.prisma.usageRecord.create({
      data: {
        type: 'sms_otp',
        costMicroUsd: Math.round(COSTS.smsUsd * 1_000_000),
      },
    });
  }

  // ─── Enregistrement (à appeler APRÈS l'action réussie) ────────────────────

  async recordAi(
    userId: string,
    type: Extract<QuotaType, 'ai_reformulation' | 'ai_reply'>,
    humhlinkerId: string,
    usage: { inputTokens: number; outputTokens: number },
  ): Promise<void> {
    const cost = aiCostMicroUsd(usage.inputTokens, usage.outputTokens);
    await this.prisma.usageRecord.create({
      data: {
        userId,
        type,
        humhlinkerId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costMicroUsd: cost,
      },
    });
    await this.safeRedis(() =>
      this.redis.incrByWithTtl(
        `budget:ai:${QuotaService.dayKey()}`,
        cost,
        TWO_DAYS,
      ),
    );
  }

  async record(
    userId: string,
    type: Extract<UsageType, 'message_sent' | 'email_to_placeholder'>,
    humhlinkerId?: string,
  ): Promise<void> {
    await this.prisma.usageRecord.create({
      data: { userId, type, humhlinkerId },
    });
  }

  // ─── Lecture pour le front ────────────────────────────────────────────────

  async getUsage(userId: string): Promise<UsageSummary> {
    const user = await this.loadUser(userId);
    const plan = this.effectivePlan(user);
    const limits = PLANS[plan];
    const unlimited = this.isUnlimited(user);

    const quotas = {} as UsageSummary['quotas'];
    for (const type of Object.keys(limits.quotas) as QuotaType[]) {
      quotas[type] = {} as Record<QuotaPeriod, PeriodUsage>;
      for (const period of ['day', 'month'] as const) {
        const { start, resetAt } = QuotaService.periodBounds(
          period,
          new Date(),
          this.monthAnchor(user, plan),
        );
        quotas[type][period] = {
          used: await this.countUsage(userId, type, start),
          limit: unlimited ? null : limits.quotas[type][period],
          resetAt: resetAt.toISOString(),
        };
      }
    }

    return {
      plan,
      planExpiresAt: user.planExpiresAt?.toISOString() ?? null,
      unlimited,
      maxMessageLength: unlimited ? 4000 : limits.maxMessageLength,
      quotas,
      activeHumlinkers: {
        used: await this.countActiveInitiatedHumlinkers(userId),
        limit: unlimited ? null : limits.activeHumlinkers,
      },
      subscription: user.subscriptionStatus
        ? {
            status: user.subscriptionStatus,
            cancelAtPeriodEnd: user.cancelAtPeriodEnd,
            currentPeriodEnd: user.currentPeriodEnd?.toISOString() ?? null,
          }
        : null,
    };
  }

  // ─── Utilitaires ──────────────────────────────────────────────────────────

  /** Redis en panne ne doit pas bloquer l'app : on logue et on continue. */
  private async safeRedis<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      this.logger.error(
        'Redis indisponible pour les disjoncteurs globaux',
        err as Error,
      );
      return null;
    }
  }

  /** Une seule alerte par type et par jour. */
  private async alertOnce(
    kind: string,
    subject: string,
    body: string,
  ): Promise<void> {
    this.logger.error(`${subject} — ${body}`);
    const first = await this.safeRedis(() =>
      this.redis.setIfAbsent(
        `alert:${kind}:${QuotaService.dayKey()}`,
        '1',
        TWO_DAYS,
      ),
    );
    if (first) await this.mail.sendAdminAlert(subject, body);
  }
}
