/**
 * NotificationsModule
 *
 * @Global() — NotificationsService + HumlinkerGateway disponibles dans toute l'app.
 *
 * JwtModule est importé directement ici (registerAsync via APP_CONFIG)
 * pour que HumlinkerGateway puisse vérifier les JWT des connexions WebSocket,
 * sans créer de dépendance circulaire avec AuthModule.
 */
import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG } from '@/config';
import configuration from '@/config/configuration';
import { NotificationsService } from './notifications.service';
import { HumlinkerGateway } from '../messages/gateway/humlinker.gateway';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: ReturnType<typeof configuration>) => ({
        secret: config.jwt.secret,
        signOptions: { expiresIn: config.jwt.expiresIn as `${number}d` | `${number}h` },
      }),
    }),
  ],
  providers: [NotificationsService, HumlinkerGateway],
  exports: [NotificationsService, HumlinkerGateway],
})
export class NotificationsModule {}
