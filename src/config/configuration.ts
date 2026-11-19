export default () => ({
  app: {
    name: process.env.APP_NAME ?? 'humlinker-api',
    env: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    url: process.env.APP_URL ?? 'http://localhost:3000',
    /** URL publique du front (la 1re si FRONTEND_URL en liste plusieurs) — liens des emails */
    frontendUrl: (process.env.FRONTEND_URL ?? 'http://localhost:5173')
      .split(',')[0]
      .trim()
      .replace(/\/$/, ''),
    downloadUrl:
      process.env.APP_DOWNLOAD_URL ?? 'https://humlinker.app/download',
  },

  database: {
    url: process.env.DATABASE_URL,
  },

  jwt: {
    secret:
      process.env.JWT_SECRET ?? 'humlinker-dev-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRATION ?? '24h',
    /** Jeton d'accès des sessions (court) — renouvelé via POST /auth/refresh */
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRATION ?? '15m',
    /** Jeton de rafraîchissement : durée de vie glissante (jours), rotation à chaque usage */
    refreshTtlDays: parseInt(process.env.JWT_REFRESH_TTL_DAYS ?? '30', 10),
  },

  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD ?? undefined,
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  },

  mail: {
    host: process.env.MAIL_HOST ?? 'smtp.gmail.com',
    port: parseInt(process.env.MAIL_PORT ?? '587', 10),
    user: process.env.MAIL_USER ?? '',
    password: process.env.MAIL_PASSWORD ?? '',
    from: process.env.MAIL_FROM ?? 'noreply@humlinker.com',
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER ?? '',
    whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER ?? '',
  },

  ai: {
    geminiApiKey: process.env.GEMINI_API_KEY ?? '',
    model: process.env.AI_MODEL ?? 'gemini-2.5-flash',
    /** Délai max d'un appel Gemini (ms) */
    timeoutMs: parseInt(process.env.AI_TIMEOUT_MS ?? '20000', 10),
    /** Plafond de tokens de sortie, raisonnement compris (borne le coût d'un appel) */
    maxOutputTokens: parseInt(process.env.AI_MAX_OUTPUT_TOKENS ?? '4096', 10),
    /**
     * Budget de « raisonnement » interne (facturé comme de la sortie).
     * 0 (défaut) = désactivé ; « auto » = le modèle décide ; nombre = plafond.
     * Mesure du 18/11/2026 sur 10 cas : qualité équivalente, 3,4× moins cher
     * et 3,4× plus rapide sans raisonnement.
     */
    /**
     * Raisonnement pour l'hébreu et l'arabe (accord du verbe au genre de
     * l'interlocuteur) : sans lui, erreurs d'accord mesurées (0/5 → 5/5 à 512).
     */
    thinkingBudgetGendered: ((): number | null => {
      const v = (process.env.AI_THINKING_BUDGET_GENDERED ?? '512')
        .trim()
        .toLowerCase();
      if (v === 'auto' || v === '') return null;
      const n = parseInt(v, 10);
      return Number.isNaN(n) ? 512 : n;
    })(),
    thinkingBudget: ((): number | null => {
      const v = (process.env.AI_THINKING_BUDGET ?? '0').trim().toLowerCase();
      if (v === 'auto' || v === '') return null;
      const n = parseInt(v, 10);
      return Number.isNaN(n) ? 0 : n;
    })(),
  },

  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID ?? '',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? '',
    privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  },
});
