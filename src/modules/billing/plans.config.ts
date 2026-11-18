/**
 * Offres Humlinker et leurs limites — SOURCE UNIQUE DE VÉRITÉ.
 *
 * L'IA est médiatrice entre deux personnes : celle qui lance le humlinker
 * ET celle qui répond passent par l'IA. D'où deux quotas IA distincts :
 *  - ai_reformulation : messages dans un humlinker que l'utilisateur a lancé
 *  - ai_reply         : réponses dans un humlinker lancé par quelqu'un d'autre
 *                       (plus généreux → la médiation ne se coupe presque jamais,
 *                        mais reste plafonné → jamais perdant)
 *
 * Règle de rentabilité : coût IA max d'un Pro (≈ 2 000 appels × ~0,002 $)
 * doit rester < 25 % du prix après frais Stripe. À réviser avec les coûts réels
 * (GET /billing/admin/costs à venir, table usage_records).
 *
 * `null` = pas de limite sur cette période.
 */
import type { PlanTier } from '../users/entities';

export type QuotaType =
  | 'ai_reformulation'
  | 'ai_reply'
  | 'message_sent'
  | 'email_to_placeholder';

export type QuotaPeriod = 'day' | 'month';

export interface PeriodLimits {
  day: number | null;
  month: number | null;
}

export interface PlanLimits {
  quotas: Record<QuotaType, PeriodLimits>;
  /** Humlinkers lancés par l'utilisateur et encore actifs (pending/active) */
  activeHumlinkers: number | null;
  /** Longueur maximale d'un message envoyé à l'IA */
  maxMessageLength: number;
}

export const PLANS: Record<PlanTier, PlanLimits> = {
  free: {
    quotas: {
      ai_reformulation: { day: 15, month: 100 },
      ai_reply: { day: 30, month: 300 },
      message_sent: { day: 10, month: null },
      email_to_placeholder: { day: null, month: 3 },
    },
    activeHumlinkers: 3,
    maxMessageLength: 1000,
  },
  pro: {
    quotas: {
      // Plafonds « fair use » : anti-abus, inatteignables en usage normal
      ai_reformulation: { day: 100, month: 1000 },
      ai_reply: { day: 100, month: 1000 },
      message_sent: { day: 100, month: null },
      email_to_placeholder: { day: 10, month: 50 },
    },
    activeHumlinkers: null,
    maxMessageLength: 4000,
  },
};

/** Tarifs pour l'estimation des coûts (surchargeables par variables d'environnement). */
export const COSTS = {
  /** Gemini — $ par million de tokens */
  aiInputPerMillionUsd: Number(process.env.AI_PRICE_INPUT_PER_M_USD ?? 0.3),
  aiOutputPerMillionUsd: Number(process.env.AI_PRICE_OUTPUT_PER_M_USD ?? 2.5),
  /** Coût moyen d'un SMS OTP ($) */
  smsUsd: Number(process.env.SMS_COST_USD ?? 0.08),
};

/** Disjoncteurs globaux (toute la plateforme, par jour UTC). */
export const GLOBAL_LIMITS = {
  /** Budget IA journalier max ($). Au-delà : IA suspendue jusqu'au lendemain + alerte. */
  dailyAiBudgetUsd: Number(process.env.GLOBAL_DAILY_AI_BUDGET_USD ?? 20),
  /** Nombre max de SMS OTP par jour. Au-delà : envoi SMS suspendu + alerte. */
  dailySmsLimit: Number(process.env.GLOBAL_DAILY_SMS_LIMIT ?? 200),
};

export function aiCostMicroUsd(
  inputTokens: number,
  outputTokens: number,
): number {
  return Math.ceil(
    inputTokens * COSTS.aiInputPerMillionUsd +
      outputTokens * COSTS.aiOutputPerMillionUsd,
  );
}
