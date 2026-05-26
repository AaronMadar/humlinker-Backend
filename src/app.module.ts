/**
 * AppModule — module racine de l'application Humlinker.
 *
 * Ordre d'import important :
 *  1. AppConfigModule    → @Global(), fournit APP_CONFIG partout
 *  2. DatabaseModule     → connexion Prisma
 *  3. RedisModule        → @Global(), fournit RedisService partout (utilisé par OtpService)
 *  4. IntegrationsModule → @Global(), fournit MailService + SmsService partout
 *  5. JobsModule         → tâches en arrière-plan
 *  6. Modules métier     → Auth, Users, Humlinker, Messages, Ai, Health
 */
import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppConfigModule } from './config';
import { DatabaseModule } from './database';
import { RedisModule } from './redis';
import { IntegrationsModule } from './integrations';
import { JobsModule } from './jobs';
import {
  AiModule,
  AuthModule,
  HumlinkerModule,
  MessagesModule,
  HealthModule,
  UsersModule,
} from './modules';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    RedisModule,        // @Global() — RedisService disponible dans toute l'app
    IntegrationsModule, // @Global() — MailService + SmsService disponibles dans toute l'app
    // EventEmitter @Global() — permet l'émission d'events entre modules (ex: sync contacts)
    EventEmitterModule.forRoot({ wildcard: false, global: true }),
    JobsModule,
    AuthModule,
    HealthModule,
    UsersModule,
    HumlinkerModule,
    MessagesModule,
    AiModule,
  ],
})
export class AppModule {}
