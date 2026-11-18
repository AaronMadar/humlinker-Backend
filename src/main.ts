import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { API_PREFIX, API_VERSION } from './common';
import { APP_CONFIG } from './config';
import configuration from './config/configuration';
import { getAllowedOrigins, validateEnv } from './config/env.validation';
import { CorsIoAdapter } from './common/adapters/cors-io.adapter';
import { HttpExceptionFilter } from './filters';
import { LoggingInterceptor } from './interceptors';
import { NotificationsService } from './modules/notifications/notifications.service';

async function bootstrap() {
  // --- Variables d'environnement : bloquant en production si incomplet ---
  validateEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const config = app.get<ReturnType<typeof configuration>>(APP_CONFIG);
  const isProduction = config.app.env === 'production';
  const allowedOrigins = getAllowedOrigins();

  // --- Derrière un reverse proxy (Railway, Render, Nginx…) : vraie IP client pour le rate limiting ---
  if (process.env.TRUST_PROXY) {
    const trustProxy = process.env.TRUST_PROXY;
    app.set('trust proxy', /^\d+$/.test(trustProxy) ? parseInt(trustProxy, 10) : trustProxy);
  }

  // --- En-têtes de sécurité HTTP ---
  // CSP désactivée hors prod pour que Swagger UI fonctionne
  app.use(helmet({ contentSecurityPolicy: isProduction ? undefined : false }));

  // --- CORS : uniquement les origines du front ---
  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // --- WebSocket (Socket.io) avec le même CORS ---
  app.useWebSocketAdapter(new CorsIoAdapter(app, allowedOrigins));

  // --- Global prefix ---
  app.setGlobalPrefix(`${API_PREFIX}/${API_VERSION}`);

  // --- Validation ---
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // --- Exception filter + Logging ---
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  // --- Firebase ---
  const notificationsService = app.get(NotificationsService);
  notificationsService.initFirebase(config.firebase);

  // --- Swagger (dev only) ---
  if (config.app.env !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Humlinker API')
      .setDescription(
        '## API Humlinker\n\n' +
        'Plateforme de communication assistee par IA. Humlinker permet d envoy' +
        'er des messages reformules, polis et diplomatiques a vos contacts via ' +
        'differents canaux (app, SMS, WhatsApp, email).\n\n' +
        '### Flow inscription\n' +
        '1. `POST /auth/send-otp/email` - envoyer OTP email\n' +
        '2. `POST /auth/verify-otp` - verifier OTP email\n' +
        '3. `POST /auth/send-otp/phone` - envoyer OTP telephone\n' +
        '4. `POST /auth/verify-otp` - verifier OTP telephone\n' +
        '5. `POST /auth/register` - creer le compte\n\n' +
        '### Auth\nToutes les routes protegees necessitent `Authorization: Bearer <token>`.',
      )
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT retourne par /auth/login, /auth/register ou /auth/google',
        },
      )
      .addTag('Auth', 'Inscription, connexion, OTP et reinitialisation')
      .addTag('Users', 'Gestion du profil utilisateur')
      .addTag('Humlinkers', 'Creation et gestion des humlinkers et contacts')
      .addTag('Messages', 'Chat IA et envoi des messages aux destinataires')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
      customSiteTitle: 'Humlinker API Docs',
    });

    console.log('Swagger: http://localhost:' + config.app.port + '/docs');
  }

  await app.listen(config.app.port);
  console.log('Server: http://localhost:' + config.app.port + '/api/v1');
}

bootstrap();
