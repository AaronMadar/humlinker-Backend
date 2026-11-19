import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { GuestScopeGuard } from './guest-scope.guard';

/** Contexte HTTP minimal : classe + méthode du contrôleur, utilisateur, params */
function ctx(
  controller: string,
  handler: string,
  user: object | undefined,
  params: Record<string, string> = {},
): ExecutionContext {
  const cls = { [controller]: class {} }[controller];
  const fn = { [handler]: () => undefined }[handler];
  return {
    getType: () => 'http',
    getClass: () => cls,
    getHandler: () => fn,
    switchToHttp: () => ({ getRequest: () => ({ user, params }) }),
  } as unknown as ExecutionContext;
}

describe('GuestScopeGuard — jeton invité limité à son humlinker', () => {
  const guard = new GuestScopeGuard();
  const guest = { userId: 'p1', role: 'user', scope: 'guest', humlinkerId: 'mirror-1' };

  it('laisse passer les jetons normaux et les routes publiques', () => {
    expect(guard.canActivate(ctx('BillingController', 'getUsage', { userId: 'u1', role: 'user' }))).toBe(true);
    expect(guard.canActivate(ctx('AuthController', 'login', undefined))).toBe(true);
  });

  it.each([
    ['UsersController', 'getMe', {}],
    ['HumlinkerController', 'getHumlinkerById', { id: 'mirror-1' }],
    ['MessagesController', 'getChat', { humhlinkerId: 'mirror-1' }],
    ['MessagesController', 'sendMessage', { humhlinkerId: 'mirror-1' }],
    ['MessagesController', 'clearHistory', { humhlinkerId: 'mirror-1' }],
    ['MessagesController', 'restoreDraftVersion', { humhlinkerId: 'mirror-1' }],
    ['MessagesController', 'sendDraft', { humhlinkerId: 'mirror-1' }],
  ])('autorise %s.%s sur son humlinker', (c, h, params) => {
    expect(guard.canActivate(ctx(c, h, guest, params))).toBe(true);
  });

  it.each([
    ['BillingController', 'getUsage', {}],
    ['UsersController', 'updateUserProfile', {}],
    ['HumlinkerController', 'getMyHumlinkers', {}],
    ['HumlinkerController', 'createHumlinker', {}],
    ['HumlinkerController', 'blockHumlinker', { id: 'mirror-1' }],
  ])('refuse %s.%s (hors liste)', (c, h, params) => {
    expect(() => guard.canActivate(ctx(c, h, guest, params))).toThrow(ForbiddenException);
  });

  it('refuse un autre humlinker, même sur une route autorisée', () => {
    expect(() =>
      guard.canActivate(ctx('MessagesController', 'getChat', guest, { humhlinkerId: 'other' })),
    ).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(ctx('HumlinkerController', 'getHumlinkerById', guest, { id: 'other' })),
    ).toThrow(ForbiddenException);
  });

  it('refuse un jeton invité sans humlinkerId', () => {
    const broken = { ...guest, humlinkerId: undefined };
    expect(() =>
      guard.canActivate(ctx('MessagesController', 'getChat', broken, { humhlinkerId: 'mirror-1' })),
    ).toThrow(ForbiddenException);
  });
});
