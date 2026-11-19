/**
 * GuestScopeGuard — restreint les jetons invités (scope 'guest').
 *
 * Enregistré globalement APRÈS JwtAuthGuard (req.user est connu) et
 * RateLimitGuard. Les jetons normaux passent sans contrôle supplémentaire.
 *
 * Un jeton invité n'ouvre QUE :
 *   GET    /users/me                           (lecture du profil, langue)
 *   GET    /humlinkers/:mirrorId
 *   GET    /humlinkers/:mirrorId/messages
 *   POST   /humlinkers/:mirrorId/messages      (parler à l'IA)
 *   DELETE /humlinkers/:mirrorId/messages
 *   PATCH  /humlinkers/:mirrorId/draft
 *   POST   /humlinkers/:mirrorId/send
 * et seulement pour SON humlinker. Tout le reste → 403.
 *
 * La liste est indexée par « Contrôleur.méthode » (et non par URL) : renommer
 * une route ne peut pas ouvrir d'accès par accident.
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { GUEST_SCOPE } from './guest-token';

/** handler autorisé → nom du paramètre de route portant l'id du humlinker (null = aucun) */
export const GUEST_ALLOWED_HANDLERS: Readonly<Record<string, string | null>> = {
  'UsersController.getMe': null,
  'HumlinkerController.getHumlinkerById': 'id',
  'MessagesController.getChat': 'humhlinkerId',
  'MessagesController.sendMessage': 'humhlinkerId',
  'MessagesController.clearHistory': 'humhlinkerId',
  'MessagesController.restoreDraftVersion': 'humhlinkerId',
  'MessagesController.sendDraft': 'humhlinkerId',
};

@Injectable()
export class GuestScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
      params?: Record<string, string>;
    }>();
    const user = req.user;
    if (!user || user.scope !== GUEST_SCOPE) return true;

    const key = `${context.getClass().name}.${context.getHandler().name}`;
    if (!(key in GUEST_ALLOWED_HANDLERS)) {
      throw new ForbiddenException(
        'Accès invité limité à votre conversation. Créez un compte pour aller plus loin.',
      );
    }

    const param = GUEST_ALLOWED_HANDLERS[key];
    if (param !== null) {
      const requested = req.params?.[param];
      if (!user.humlinkerId || requested !== user.humlinkerId) {
        throw new ForbiddenException(
          "Ce lien ne donne accès qu'à une seule conversation.",
        );
      }
    }
    return true;
  }
}
