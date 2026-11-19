import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AccountDeletionService } from './account-deletion.service';

describe('AccountDeletionService', () => {
  const baseUser = {
    _id: 'u1',
    language: 'fr',
    passwordHash: null as string | null,
    stripeSubscriptionId: null as string | null,
  };

  function setup(user: typeof baseUser | null) {
    const usersRepository = { findById: jest.fn().mockResolvedValue(user) };
    const prisma = {
      humlinker: {
        findMany: jest.fn().mockResolvedValue([{ id: 'h1' }, { id: 'h2' }]),
        updateMany: jest.fn().mockReturnValue('updateMany'),
        deleteMany: jest.fn().mockReturnValue('deleteMany'),
      },
      user: { update: jest.fn().mockReturnValue('userUpdate') },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const redis = { del: jest.fn().mockResolvedValue(undefined) };
    const stripe = { cancelSubscriptionNow: jest.fn().mockResolvedValue(undefined) };
    const sessions = { revokeAll: jest.fn().mockResolvedValue(1) };
    const service = new AccountDeletionService(
      usersRepository as never,
      prisma as never,
      redis as never,
      stripe as never,
      sessions as never,
    );
    return { service, prisma, redis, stripe, sessions };
  }

  it('anonymise le compte, supprime son côté et bloque le côté des autres', async () => {
    const { service, prisma, redis } = setup({ ...baseUser });
    await service.deleteAccount('u1');

    expect(prisma.$transaction).toHaveBeenCalledWith([
      'updateMany',
      'deleteMany',
      'userUpdate',
    ]);
    const others = prisma.humlinker.updateMany.mock.calls[0][0];
    expect(others.where).toEqual({ targetId: 'u1' });
    expect(others.data.status).toBe('blocked');
    expect(others.data.targetSnapshot).toMatchObject({ deleted: true, email: null, firstName: null });
    expect(prisma.humlinker.deleteMany).toHaveBeenCalledWith({ where: { senderId: 'u1' } });
    const anon = prisma.user.update.mock.calls[0][0].data;
    expect(anon).toMatchObject({ email: null, phoneNumber: null, passwordHash: null, firstName: null });
    expect(anon.deletedAt).toBeInstanceOf(Date);
    expect(redis.del).toHaveBeenCalledTimes(2);
  });

  it('révoque toutes les sessions du compte supprimé', async () => {
    const { service, sessions } = setup({ ...baseUser });
    await service.deleteAccount('u1');
    expect(sessions.revokeAll).toHaveBeenCalledWith('u1');
  });

  it('résilie l’abonnement Stripe actif', async () => {
    const { service, stripe } = setup({ ...baseUser, stripeSubscriptionId: 'sub_1' });
    await service.deleteAccount('u1');
    expect(stripe.cancelSubscriptionNow).toHaveBeenCalledWith('sub_1');
  });

  it('exige le bon mot de passe pour un compte avec mot de passe', async () => {
    const passwordHash = await bcrypt.hash('secret123', 4);
    const { service, prisma } = setup({ ...baseUser, passwordHash });
    await expect(service.deleteAccount('u1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.deleteAccount('u1', 'faux')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    await service.deleteAccount('u1', 'secret123');
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
