import { getAllowedOrigins, validateEnv } from './env.validation';

const validProdEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db:5432/x',
  JWT_SECRET: 'a'.repeat(48),
  FRONTEND_URL: 'https://app.humlinker.com',
  REDIS_HOST: 'redis',
  GEMINI_API_KEY: 'key',
  GOOGLE_CLIENT_ID: 'id',
  MAIL_HOST: 'smtp.example.com',
  MAIL_USER: 'user',
  MAIL_PASSWORD: 'pass',
  TWILIO_ACCOUNT_SID: 'sid',
  TWILIO_AUTH_TOKEN: 'token',
} as NodeJS.ProcessEnv;

describe('validateEnv', () => {
  it('accepte une configuration de production complète', () => {
    expect(() => validateEnv(validProdEnv)).not.toThrow();
  });

  it('refuse de démarrer en production sans JWT_SECRET', () => {
    expect(() => validateEnv({ ...validProdEnv, JWT_SECRET: '' })).toThrow(
      /démarrage annulé/,
    );
  });

  it('refuse un JWT_SECRET trop court ou resté à la valeur d’exemple', () => {
    expect(() =>
      validateEnv({ ...validProdEnv, JWT_SECRET: 'short' }),
    ).toThrow();
    expect(() =>
      validateEnv({
        ...validProdEnv,
        JWT_SECRET: 'your_jwt_secret_key_here_change_it_in_production',
      }),
    ).toThrow();
  });

  it('refuse un front en http:// en production', () => {
    expect(() =>
      validateEnv({
        ...validProdEnv,
        FRONTEND_URL: 'http://app.humlinker.com',
      }),
    ).toThrow();
  });

  it('ne bloque pas en développement', () => {
    expect(() => validateEnv({ NODE_ENV: 'development' })).not.toThrow();
  });
});

describe('getAllowedOrigins', () => {
  it('en production : uniquement FRONTEND_URL (plusieurs valeurs possibles)', () => {
    expect(
      getAllowedOrigins({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://a.com/, https://b.com',
      }),
    ).toEqual(['https://a.com', 'https://b.com']);
  });

  it('en développement : ajoute le front Vite local', () => {
    expect(getAllowedOrigins({ NODE_ENV: 'development' })).toContain(
      'http://localhost:5173',
    );
  });
});
