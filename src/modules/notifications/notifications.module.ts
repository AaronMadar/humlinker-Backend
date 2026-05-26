/**
 * NotificationsModule
 *
 * @Global() — NotificationsService disponible dans toute l'app.
 * Dépend de HumlinkerGateway (WebSocket) pour les notifications temps réel.
 */
import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { HumlinkerGateway } from '../messages/gateway/humlinker.gateway';

@Global()
@Module({
  providers: [NotificationsService, HumlinkerGateway],
  exports: [NotificationsService, HumlinkerGateway],
})
export class NotificationsModule {}
