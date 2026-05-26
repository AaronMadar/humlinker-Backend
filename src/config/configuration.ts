/**
 * Configuration globale de l'application.
 *
 * Toutes les variables d'environnement sont centralisées ici.
 * Chaque module qui a besoin de config injecte APP_CONFIG via @Inject(APP_CONFIG).
 *
 * Variables requises (voir .env.example) :
 *  - DATABASE_URL
 *  - JWT_SECRET
 *  - REDIS_HOST, REDIS_PORT
 *  - GOOGLE_CLIENT_ID
 *  - MAIL_HOST, MAIL_USER, MAIL_PASSWORD, MAIL_FROM
 *  - TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
 */
export default () => ({
  app: {
    name: process.env.APP_NAME ?? 'humlinker-api',
    env: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    url: process.env.APP_URL ?? 'http://localhost:3000',
  },

  database: {
    url: process.env.DATABASE_URL,
  },

  jwt: {
    secret:
      process.env.JWT_SECRET ?? 'humlinker-dev-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRATION ?? '24h',
  },

  // Redis — stockage des OTP et des flags "verified" pendant le flow d'inscription
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD ?? undefined,
  },

  // Google OAuth — vérification des idToken lors du login/register Google
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  },

  // Mail — envoi des OTP par email via Nodemailer (SMTP)
  mail: {
    host: process.env.MAIL_HOST ?? 'smtp.gmail.com',
    port: parseInt(process.env.MAIL_PORT ?? '587', 10),
    user: process.env.MAIL_USER ?? '',
    password: process.env.MAIL_PASSWORD ?? '',
    from: process.env.MAIL_FROM ?? 'noreply@humlinker.com',
  },

  // Twilio — envoi des OTP par SMS
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER ?? '',
  },
});
