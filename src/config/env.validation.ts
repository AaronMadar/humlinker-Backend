/**
 * Validation des variables d'environnement au démarrage.
 *
 * En production, l'application REFUSE de démarrer si une variable critique manque
 * ou est restée à une valeur d'exemple → impossible de partir en prod avec
 * un secret JWT par défaut, un CORS ouvert ou une clé manquante.
 * En développement, on affiche seulement des avertissements.
 */
import { Logger } from '@nestjs/common';

const REQUIRED_IN_PRODUCTION = [
  'DATABASE_URL',
  'JWT_SECRET',
  'FRONTEND_URL',
  'REDIS_HOST',
  'GEMINI_API_KEY',
  'GOOGLE_CLIENT_ID',
  'MAIL_HOST',
  'MAIL_USER',
  'MAIL_PASSWORD',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_PRO_MONTHLY',
  'STRIPE_PRICE_PRO_YEARLY',
] as const;

/** Valeurs d'exemple de .env.example qui ne doivent jamais arriver en prod. */
const PLACEHOLDER_PATTERNS = [
  /^your_/i,
  /change_it/i,
  /change-in-production/i,
  /xxxxx/i,
];

const MIN_JWT_SECRET_LENGTH = 32;

export function validateEnv(env: NodeJS.ProcessEnv = process.env): void {
  const logger = new Logger('EnvValidation');
  const isProduction = env.NODE_ENV === 'production';
  const problems: string[] = [];

  for (const name of REQUIRED_IN_PRODUCTION) {
    const value = env[name]?.trim();
    if (!value) {
      problems.push(`${name} est manquant`);
    } else if (PLACEHOLDER_PATTERNS.some((re) => re.test(value))) {
      problems.push(`${name} contient encore une valeur d'exemple`);
    }
  }

  const jwtSecret = env.JWT_SECRET ?? '';
  if (jwtSecret && jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    problems.push(
      `JWT_SECRET doit faire au moins ${MIN_JWT_SECRET_LENGTH} caractères`,
    );
  }

  const frontendUrl = env.FRONTEND_URL ?? '';
  if (
    isProduction &&
    frontendUrl
      .split(',')
      .some((o) => o.trim() && !o.trim().startsWith('https://'))
  ) {
    problems.push('FRONTEND_URL doit être en https:// en production');
  }

  if (!problems.length) return;

  if (isProduction) {
    for (const p of problems) logger.error(p);
    throw new Error(
      `Configuration invalide pour la production (${problems.length} problème(s)) — démarrage annulé.`,
    );
  }

  logger.warn(
    `Configuration incomplète (acceptable en développement, bloquant en production) :\n - ${problems.join('\n - ')}`,
  );
}

/**
 * Origines autorisées pour le CORS (HTTP + WebSocket).
 * FRONTEND_URL peut contenir plusieurs URLs séparées par des virgules.
 * En développement, le front Vite local est autorisé par défaut.
 */
export function getAllowedOrigins(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const configured = (env.FRONTEND_URL ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);

  if (env.NODE_ENV === 'production') return configured;

  return Array.from(
    new Set([...configured, 'http://localhost:5173', 'http://127.0.0.1:5173']),
  );
}
