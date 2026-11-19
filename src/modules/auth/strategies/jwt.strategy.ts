import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { APP_CONFIG } from '@/config';
import configuration from '@/config/configuration';
import {
  USERS_REPOSITORY,
  type UsersRepository,
} from '@/modules/users/repositories';
import { GUEST_SCOPE } from '../guest/guest-token';
import { SessionService } from '../sessions/session.service';
import type { AuthenticatedUser, JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(APP_CONFIG)
    private readonly config: ReturnType<typeof configuration>,
    @Inject(USERS_REPOSITORY)
    private readonly usersRepository: UsersRepository,
    private readonly sessions: SessionService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwt.secret,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.usersRepository.findById(payload.userId);
    if (!user) {
      throw new UnauthorizedException('Invalid token');
    }

    // Jeton invité (lien « Répondre » d'un email) : seulement pour un
    // destinataire encore sans compte. Une fois inscrit, il se connecte
    // normalement et l'ancien lien ne fonctionne plus.
    if (payload.scope !== undefined) {
      if (
        payload.scope !== GUEST_SCOPE ||
        !payload.humlinkerId ||
        !user.isPlaceholder
      ) {
        throw new UnauthorizedException('Invalid token');
      }
      return {
        userId: user._id,
        role: 'user',
        scope: GUEST_SCOPE,
        humlinkerId: payload.humlinkerId,
      };
    }

    // Session : version (déconnexion de tous les appareils, mot de passe changé…)
    // et session encore ouverte (déconnexion de cet appareil, réutilisation détectée)
    if (!(await this.sessions.isAccessPayloadValid(payload, user.tokenVersion ?? 0))) {
      throw new UnauthorizedException('Session expirée ou révoquée');
    }

    return {
      userId: user._id,
      role: user.role,
      ...(payload.sid && { sid: payload.sid }),
    };
  }
}
