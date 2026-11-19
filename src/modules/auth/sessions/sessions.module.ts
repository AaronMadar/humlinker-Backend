/**
 * SessionsModule — sessions de connexion (voir session.service.ts).
 *
 * Module autonome (Prisma, Redis et EventEmitter sont globaux) : importable par
 * AuthModule, UsersModule et MessagesModule sans dépendance circulaire.
 */
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG } from '@/config';
import configuration from '@/config/configuration';
import { SessionService } from './session.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: ReturnType<typeof configuration>) => ({
        secret: config.jwt.secret,
      }),
    }),
  ],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionsModule {}
