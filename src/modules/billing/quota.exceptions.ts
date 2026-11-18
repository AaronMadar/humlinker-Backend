import { HttpException, HttpStatus } from '@nestjs/common';
import type { PlanTier } from '../users/entities';
import type { QuotaPeriod, QuotaType } from './plans.config';

/** Codes d'erreur stables — le front s'en sert pour afficher un message traduit. */
export const QUOTA_EXCEEDED = 'QUOTA_EXCEEDED';
export const HUMLINKER_LIMIT_REACHED = 'HUMLINKER_LIMIT_REACHED';
export const MESSAGE_TOO_LONG = 'MESSAGE_TOO_LONG';
export const SERVICE_BUDGET_EXCEEDED = 'SERVICE_BUDGET_EXCEEDED';

const QUOTA_LABELS: Record<QuotaType, string> = {
  ai_reformulation: 'reformulations IA',
  ai_reply: 'réponses IA',
  message_sent: 'envois de messages',
  email_to_placeholder: 'emails à des personnes non inscrites',
};

/** 402 Payment Required : limite de l'offre atteinte → proposer l'offre Pro. */
export class QuotaExceededException extends HttpException {
  constructor(details: {
    quota: QuotaType;
    period: QuotaPeriod;
    limit: number;
    used: number;
    resetAt: Date;
    plan: PlanTier;
  }) {
    const when = details.period === 'day' ? "aujourd'hui" : 'ce mois-ci';
    super(
      {
        message: `Vous avez atteint votre limite de ${details.limit} ${QUOTA_LABELS[details.quota]} ${when}.`,
        code: QUOTA_EXCEEDED,
        details: { ...details, resetAt: details.resetAt.toISOString() },
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

export class HumlinkerLimitException extends HttpException {
  constructor(details: { limit: number; used: number; plan: PlanTier }) {
    super(
      {
        message: `Votre offre permet ${details.limit} humlinkers actifs. Archivez-en un ou passez à l'offre Pro.`,
        code: HUMLINKER_LIMIT_REACHED,
        details,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

export class MessageTooLongException extends HttpException {
  constructor(details: { limit: number; length: number; plan: PlanTier }) {
    super(
      {
        message: `Votre message dépasse ${details.limit} caractères (limite de votre offre).`,
        code: MESSAGE_TOO_LONG,
        details,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/** 503 : disjoncteur global atteint (protection des coûts de la plateforme). */
export class ServiceBudgetExceededException extends HttpException {
  constructor() {
    super(
      {
        message:
          'Le service est momentanément saturé. Veuillez réessayer dans quelques heures.',
        code: SERVICE_BUDGET_EXCEEDED,
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
