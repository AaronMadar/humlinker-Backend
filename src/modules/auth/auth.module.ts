/**
 * AuthModule
 *
 * Module d'authentification de Humlinker.
 *
 * Providers enregistrés :
 *  - AuthService      → logique d'auth (register, login, google, OTP)
 *  - OtpService       → génération / vérification des codes OTP via Redis
 *  - JwtStrategy      → stratégie Passport pour valider les JWT entrants
 *  - JwtAuthGuard     → guard global appliqué à toutes les routes (sauf @Public())
 *
 * Imports :
 *  - UsersModule      → accès au repository users (forwardRef pour éviter la dépendance circulaire)
 *  - PassportModule   → stratégie JWT Passport
 *  - JwtModule        → signature et vérification des JWT
 *
 * Note : RedisModule et IntegrationsModule sont @Global() donc pas besoin de les importer ici.
 */
import { Module, forwardRef } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { APP_CONFIG } from '@/config';
import configuration from '@/config/configuration';
import { JwtAuthGuard } from '@/guards';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './services/otp.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: ReturnType<typeof configuration>) => ({
        secret: config.jwt.secret,
        signOptions: {
          expiresIn: config.jwt.expiresIn as `${number}d` | `${number}h`,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService, // Gère les codes OTP via Redis + Mail + SMS
    JwtStrategy,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard, // Guard JWT global — toutes les routes sont protégées sauf @Public()
    },
  ],
  exports: [AuthService, JwtModule, PassportModule],
})
export class AuthModule {}
