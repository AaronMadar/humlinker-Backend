import { Module, forwardRef } from '@nestjs/common';
import { HumlinkerModule } from '../humlinker/humlinker.module';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../../integrations/mail/mail.module';
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
    MailModule,
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
