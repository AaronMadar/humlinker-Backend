/**
 * HumlinkerModule
 *
 * Gère les humlinkers et la synchronisation des contacts.
 *
 * ─── Providers ────────────────────────────────────────────────────────────
 *  HumlinkerService          → logique métier humlinkers
 *  ContactsService           → sync contacts + listener EventEmitter
 *  PrismaHumlinkerRepository → implémentation Prisma du repository humlinker
 *  PrismaContactsRepository  → implémentation Prisma du repository contacts
 *
 * ─── Dépendances ──────────────────────────────────────────────────────────
 *  UsersModule → UsersService (création placeholder) + USERS_REPOSITORY
 */
import { Module, forwardRef } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { HumlinkerController } from './humlinker.controller';
import { HumlinkerService } from './humlinker.service';
import {
  PrismaHumlinkerRepository,
  HUMLINKER_REPOSITORY,
} from './repositories';

@Module({
  imports: [forwardRef(() => UsersModule)],
  controllers: [HumlinkerController],
  providers: [
    HumlinkerService,
    PrismaHumlinkerRepository,
    {
      provide: HUMLINKER_REPOSITORY,
      useExisting: PrismaHumlinkerRepository,
    },
  ],
  exports: [
    HumlinkerService,
    HUMLINKER_REPOSITORY,
    PrismaHumlinkerRepository,
  ],
})
export class HumlinkerModule {}
