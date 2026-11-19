/**
 * Jeton invité — « répondre sans installer l'appli ».
 *
 * Un destinataire sans compte (utilisateur placeholder, canal email) reçoit
 * dans l'email un lien `${frontend}/reply/<jeton>`. Ce jeton est un JWT signé
 * avec le même secret que les sessions, mais restreint :
 *   { userId: <placeholder>, scope: 'guest', humlinkerId: <son humlinker miroir> }
 * Le GuestScopeGuard limite ce qu'il permet de faire (voir guest-scope.guard.ts).
 */
import type { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from '../interfaces/jwt-payload.interface';

export const GUEST_SCOPE = 'guest' as const;
export const GUEST_TOKEN_TTL = '30d';

export function signGuestToken(
  jwtService: JwtService,
  placeholderUserId: string,
  mirrorHumlinkerId: string,
): string {
  const payload: JwtPayload = {
    userId: placeholderUserId,
    scope: GUEST_SCOPE,
    humlinkerId: mirrorHumlinkerId,
  };
  return jwtService.sign(payload, { expiresIn: GUEST_TOKEN_TTL });
}
