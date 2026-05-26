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
/**
 * AppModule — module racine de l'application Humlinker.
 *
 * Ordre d'import important :
 *  1. AppConfigModule      → @Global(), fournit APP_CONFIG partout
 *  2. DatabaseModule       → connexion Prisma
 *  3. RedisModule          → @Global(), RedisService (OTP)
 *  4. IntegrationsModule   → @Global(), MailService + SmsService
 *  5. EventEmitterModule   → @Global(), events inter-modules (sync contacts)
 *  6. AiModule             → @Global(), AiService Gemini
 *  7. NotificationsModule  → @Global(), WebSocket Gateway + FCM
 *  8. JobsModule           → tâches en arrière-plan
 *  9. Modules métier       → Auth, Users, Humlinker, Messages, Health
 */
import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppConfigModule } from './config';
import { DatabaseModule } from './database';
import { RedisModule } from './redis';
import { IntegrationsModule } from './integrations';
import { NotificationsModule } from './modules/notifications/notifications.module';
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
    RedisModule,
    IntegrationsModule,
    EventEmitterModule.forRoot({ wildcard: false, global: true }),
    AiModule,             // @Global() — AiService disponible partout
    NotificationsModule,  // @Global() — WebSocket Gateway + FCM disponibles partout
    JobsModule,
    AuthModule,
    HealthModule,
    UsersModule,
    HumlinkerModule,
    MessagesModule,
  ],
})
export class AppModule {}
