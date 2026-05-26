import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';
import { API_PREFIX, API_VERSION } from './common';
import { APP_CONFIG } from './config';
import configuration from './config/configuration';
import { HttpExceptionFilter } from './filters';
import { LoggingInterceptor } from './interceptors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = app.get<ReturnType<typeof configuration>>(APP_CONFIG);

  // ─── CORS ─────────────────────────────────────────────────────────────────
  // En production, remplacer '*' par le domaine exact du front (ex: https://humlinker.com)
  app.enableCors({
    origin: config.app.env === 'production'
      ? (process.env.FRONTEND_URL ?? false)
      : '*',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // ─── WebSocket (Socket.io) ─────────────────────────────────────────────────
  // IoAdapter est requis pour que @nestjs/websockets fonctionne avec socket.io.
  // Sans ça, NestJS utilise 'ws' par défaut et le gateway ne répond pas.
  app.useWebSocketAdapter(new IoAdapter(app));

  // ─── Global prefix ────────────────────────────────────────────────────────
  app.setGlobalPrefix(`${API_PREFIX}/${API_VERSION}`);

  // ─── Validation ───────────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,          // strip champs non déclarés dans le DTO
      forbidNonWhitelisted: true, // 400 si champs inconnus envoyés
      transform: true,          // cast automatique (string → number pour @Query, etc.)
    }),
  );

  // ─── Exception filter + Logging ───────────────────────────────────────────
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  await app.listen(config.app.port);
  console.log(`🚀 Server is running on http://localhost:${config.app.port}/api/v1`);
}

bootstrap();
