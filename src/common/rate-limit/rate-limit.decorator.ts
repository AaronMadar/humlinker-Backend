import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rate_limit_rules';
export const SKIP_RATE_LIMIT_KEY = 'skip_rate_limit';

/**
 * Règle de limitation :
 *  - by: 'ip'   → compteur par adresse IP (routes publiques)
 *  - by: 'user' → compteur par utilisateur connecté (repli sur l'IP si non connecté)
 *  - limit      → nombre maximum de requêtes dans la fenêtre
 *  - windowSec  → durée de la fenêtre en secondes
 */
export interface RateLimitRule {
  name: string;
  by: 'ip' | 'user';
  limit: number;
  windowSec: number;
}

/**
 * Applique des limites spécifiques à une route (en plus de la limite globale par IP).
 *
 * @example
 *   @RateLimit({ name: 'otp-sms-hour', by: 'ip', limit: 5, windowSec: 3600 })
 */
export const RateLimit = (...rules: RateLimitRule[]) =>
  SetMetadata(RATE_LIMIT_KEY, rules);

/** Désactive toute limitation sur une route (ex : health check). */
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT_KEY, true);

/** Durées pratiques. */
export const MINUTE = 60;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
