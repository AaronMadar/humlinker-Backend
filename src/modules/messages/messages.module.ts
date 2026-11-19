import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG } from '../../config';
import configuration from '../../config/configuration';
import { HumlinkerModule } from '../humlinker/humlinker.module';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../../integrations/mail/mail.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
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
    // Signature des jetons invités (lien « Répondre » des emails) — même secret
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: ReturnType<typeof configuration>) => ({
        secret: config.jwt.secret,
      }),
    }),
  ],
  controllers: [MessagesController],
  providers: [
    MessagesService,
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
