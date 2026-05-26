/**
 * UsersModule
 *
 * Gère les profils utilisateurs.
 *
 * OtpService est importé via AuthModule (forwardRef) pour les flows
 * de changement d'email et de téléphone qui nécessitent une vérification OTP.
 */
import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OtpService } from '../auth/services/otp.service';
import { PrismaUsersRepository } from './repositories/prisma-users.repository';
import { USERS_REPOSITORY } from './repositories/users.repository';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [UsersController],
  providers: [
    UsersService,
    OtpService,
    PrismaUsersRepository,
    {
      provide: USERS_REPOSITORY,
      useExisting: PrismaUsersRepository,
    },
  ],
  exports: [UsersService, USERS_REPOSITORY, PrismaUsersRepository],
})
export class UsersModule {}
