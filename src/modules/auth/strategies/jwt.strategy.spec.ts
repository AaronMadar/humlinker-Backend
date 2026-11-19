import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy — sessions', () => {
  function setup(user: Record<string, unknown> | null, sessionValid = true) {
    const repo = { findById: jest.fn().mockResolvedValue(user) };
    const sessions = { isAccessPayloadValid: jest.fn().mockResolvedValue(sessionValid) };
    const strategy = new JwtStrategy(
      { jwt: { secret: 's' } } as never,
      repo as never,
      sessions as never,
    );
    return { strategy, sessions };
  }

  it('accepte un jeton de session valide et expose le sid', async () => {
    const { strategy, sessions } = setup({ _id: 'u1', role: 'user', tokenVersion: 2 });
    await expect(
      strategy.validate({ userId: 'u1', role: 'user', tv: 2, sid: 'abc' }),
    ).resolves.toEqual({ userId: 'u1', role: 'user', sid: 'abc' });
    expect(sessions.isAccessPayloadValid).toHaveBeenCalledWith(
      expect.objectContaining({ sid: 'abc' }),
      2,
    );
  });

  it('refuse un jeton de session révoquée ou d’une ancienne version', async () => {
    const { strategy } = setup({ _id: 'u1', role: 'user', tokenVersion: 3 }, false);
    await expect(
      strategy.validate({ userId: 'u1', tv: 2, sid: 'abc' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('jeton invité : pas de contrôle de session (lien « Répondre » intact)', async () => {
    const { strategy, sessions } = setup({ _id: 'p1', role: 'user', isPlaceholder: true, tokenVersion: 5 }, false);
    await expect(
      strategy.validate({ userId: 'p1', scope: 'guest', humlinkerId: 'h1' }),
    ).resolves.toEqual({ userId: 'p1', role: 'user', scope: 'guest', humlinkerId: 'h1' });
    expect(sessions.isAccessPayloadValid).not.toHaveBeenCalled();
  });
});
