import { Module } from '@nestjs/common';
import { AppConfigModule } from './config';
import { DatabaseModule } from './database';
import { IntegrationsModule } from './integrations';
import { JobsModule } from './jobs';
import {
  AiModule,
  AuthModule,
  HealthModule,
  HumlinkerModule,
  MessagesModule,
  UsersModule,
} from './modules';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    IntegrationsModule,
    JobsModule,
    HealthModule,
    AuthModule,
    UsersModule,
    HumlinkerModule,
    MessagesModule,
    AiModule,
  ],
})
export class AppModule {}
