/**
 * MessagesModule
 *
 * Gère tout le cycle de vie du chat à l'intérieur des humlinkers.
 *
 * ─── Providers ────────────────────────────────────────────────────────────
 *  MessagesService           → logique chat (getChat, sendMessage, sendDraft)
 *  WebhookService            → traitement webhooks Twilio entrants
 *  PrismaChatMessageRepository → stockage des messages chat
 *  PrismaDraftRepository       → stockage des drafts
 *
 * ─── Controllers ─────────────────────────────────────────────────────────
 *  MessagesController  → GET/POST /humlinkers/:id/messages + POST /humlinkers/:id/send
 *  WebhookController   → POST /webhooks/twilio
 *
 * ─── Dépendances ─────────────────────────────────────────────────────────
 *  HumlinkerModule → HumlinkerRepository (accès aux humlinkers)
 *  UsersModule     → UsersRepository (fcmToken, profil)
 *  AiModule        → AiService (@Global — disponible sans import)
 *  NotificationsModule → NotificationsService + HumlinkerGateway (@Global)
 */
import { Module, forwardRef } from '@nestjs/common';
import { HumlinkerModule } from '../humlinker/humlinker.module';
import { UsersModule } from '../users/users.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { WebhookService } from './services/webhook.service';
import { WebhookController } from './services/webhook.controller';
import {
  PrismaChatMessageRepository,
  PrismaDraftRepository,
  CHAT_MESSAGE_REPOSITORY,
  DRAFT_REPOSITORY,
} from './repositories';

@Module({
  imports: [
    forwardRef(() => HumlinkerModule),
    forwardRef(() => UsersModule),
  ],
  controllers: [MessagesController, WebhookController],
  providers: [
    MessagesService,
    WebhookService,
    PrismaChatMessageRepository,
    PrismaDraftRepository,
    {
      provide: CHAT_MESSAGE_REPOSITORY,
      useExisting: PrismaChatMessageRepository,
    },
    {
      provide: DRAFT_REPOSITORY,
      useExisting: PrismaDraftRepository,
    },
  ],
  exports: [MessagesService],
})
export class MessagesModule {}
