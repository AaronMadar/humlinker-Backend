import Stripe from 'stripe';
import { QuotaService } from './quota.service';
import { StripeService, snapshotFromSubscription } from './stripe.service';

const DAY = 24 * 60 * 60 * 1000;
const ts = (d: Date) => Math.floor(d.getTime() / 1000);

function sub(
  status: Stripe.Subscription.Status,
  start: Date,
  end: Date,
  extra: Partial<Stripe.Subscription> = {},
) {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status,
    cancel_at_period_end: false,
    metadata: { userId: 'u1' },
    items: {
      data: [{ current_period_start: ts(start), current_period_end: ts(end) }],
    },
    ...extra,
  } as unknown as Stripe.Subscription;
}

describe('snapshotFromSubscription', () => {
  const start = new Date('2026-11-10T12:00:00Z');
  const end = new Date('2026-12-10T12:00:00Z');

  it('active → Pro jusqu’à la fin de période + 2 jours de marge', () => {
    const snap = snapshotFromSubscription(sub('active', start, end));
    expect(snap.plan).toBe('pro');
    expect(snap.planExpiresAt!.getTime()).toBe(end.getTime() + 2 * DAY);
    expect(snap.currentPeriodStart).toEqual(start);
  });

  it('résiliation demandée → Pro jusqu’à la fin de période exacte, sans marge', () => {
    const snap = snapshotFromSubscription(
      sub('active', start, end, { cancel_at_period_end: true }),
    );
    expect(snap.plan).toBe('pro');
    expect(snap.cancelAtPeriodEnd).toBe(true);
    expect(snap.planExpiresAt).toEqual(end);
  });

  it('past_due → seulement 3 jours de grâce après le début de période (pas un mois offert)', () => {
    const snap = snapshotFromSubscription(sub('past_due', start, end));
    expect(snap.plan).toBe('pro');
    expect(snap.planExpiresAt!.getTime()).toBe(start.getTime() + 3 * DAY);
  });

  it.each([
    'canceled',
    'unpaid',
    'incomplete',
    'incomplete_expired',
    'paused',
  ] as const)('%s → free', (status) => {
    const snap = snapshotFromSubscription(sub(status, start, end));
    expect(snap.plan).toBe('free');
    expect(snap.planExpiresAt).toBeNull();
  });
});

describe('QuotaService.periodBounds (mois ancré sur l’abonnement)', () => {
  it('repart chaque mois le jour de l’abonnement', () => {
    const anchor = new Date('2026-01-18T09:00:00Z');
    const { start, resetAt } = QuotaService.periodBounds(
      'month',
      new Date('2026-11-20T00:00:00Z'),
      anchor,
    );
    expect(start.toISOString()).toBe('2026-11-18T09:00:00.000Z');
    expect(resetAt.toISOString()).toBe('2026-12-18T09:00:00.000Z');
  });

  it('avant le jour anniversaire, la période a commencé le mois précédent', () => {
    const anchor = new Date('2026-01-18T09:00:00Z');
    const { start } = QuotaService.periodBounds(
      'month',
      new Date('2026-11-05T00:00:00Z'),
      anchor,
    );
    expect(start.toISOString()).toBe('2026-10-18T09:00:00.000Z');
  });

  it('abonnement le 31 → fin février bornée au dernier jour du mois', () => {
    const anchor = new Date('2026-01-31T00:00:00Z');
    const { start, resetAt } = QuotaService.periodBounds(
      'month',
      new Date('2026-03-01T00:00:00Z'),
      anchor,
    );
    expect(start.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(resetAt.toISOString()).toBe('2026-03-31T00:00:00.000Z');
  });

  it('sans ancre (gratuit) : mois calendaire', () => {
    const { start } = QuotaService.periodBounds(
      'month',
      new Date('2026-11-20T00:00:00Z'),
    );
    expect(start.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });
});

describe('StripeService — webhooks', () => {
  const SECRET = 'whsec_test_secret';
  let users: Map<string, any>;
  let prisma: any;
  let service: StripeService;
  let retrieve: jest.Mock;

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_month';

    users = new Map([
      [
        'u1',
        {
          id: 'u1',
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          subscriptionStatus: null,
        },
      ],
    ]);
    const find = ({ where }: any) =>
      where.id
        ? (users.get(where.id) ?? null)
        : ([...users.values()].find(
            (u) => u.stripeCustomerId === where.stripeCustomerId,
          ) ?? null);
    prisma = {
      user: {
        findUnique: jest.fn(async (args) => find(args)),
        update: jest.fn(async ({ where, data }) => {
          const u = users.get(where.id);
          Object.assign(u, data);
          return u;
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          const u = users.get(where.id);
          if (u && u.stripeCustomerId === where.stripeCustomerId)
            Object.assign(u, data);
          return { count: 1 };
        }),
      },
      stripeEvent: { upsert: jest.fn(async () => ({})) },
    };

    service = new StripeService(prisma);
    retrieve = jest.fn();
    // On garde le vrai module webhooks (signature) et on simule l'API subscriptions
    (service as any).stripe.subscriptions = { retrieve };
  });

  const sign = (payload: string) =>
    new Stripe('sk_test_dummy').webhooks.generateTestHeaderString({
      payload,
      secret: SECRET,
    });

  it('rejette une signature invalide (400)', () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'ping' });
    expect(() =>
      service.constructEvent(Buffer.from(payload), 't=1,v1=faux'),
    ).toThrow('Signature Stripe invalide.');
  });

  it('rejette un corps modifié après signature', () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'ping' });
    const header = sign(payload);
    const tampered = payload.replace('ping', 'pong');
    expect(() =>
      service.constructEvent(Buffer.from(tampered), header),
    ).toThrow();
  });

  it('checkout terminé → relie le client et passe l’utilisateur en Pro', async () => {
    const now = new Date();
    retrieve.mockResolvedValue(
      sub('active', now, new Date(now.getTime() + 30 * DAY)),
    );

    const payload = JSON.stringify({
      id: 'evt_checkout',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          object: 'checkout.session',
          mode: 'subscription',
          subscription: 'sub_1',
          customer: 'cus_1',
          client_reference_id: 'u1',
          metadata: { userId: 'u1' },
        },
      },
    });
    const event = service.constructEvent(Buffer.from(payload), sign(payload));
    await service.handleEvent(event);

    const u = users.get('u1');
    expect(retrieve).toHaveBeenCalledWith('sub_1');
    expect(u).toMatchObject({
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      plan: 'pro',
      subscriptionStatus: 'active',
    });
    expect(prisma.stripeEvent.upsert).toHaveBeenCalled();
  });

  it('abonnement supprimé → retour en free', async () => {
    users.get('u1').stripeCustomerId = 'cus_1';
    const now = new Date();
    retrieve.mockResolvedValue(
      sub('canceled', now, new Date(now.getTime() + 30 * DAY)),
    );

    await service.handleEvent({
      id: 'evt_del',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1' } },
    } as unknown as Stripe.Event);

    expect(users.get('u1')).toMatchObject({
      plan: 'free',
      planExpiresAt: null,
    });
  });

  it('un ancien abonnement terminé n’écrase pas un abonnement actif plus récent', async () => {
    Object.assign(users.get('u1'), {
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_new',
      subscriptionStatus: 'active',
      plan: 'pro',
    });
    const now = new Date();
    retrieve.mockResolvedValue(sub('canceled', now, now, { id: 'sub_old' }));

    await service.handleEvent({
      id: 'evt_old',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_old' } },
    } as unknown as Stripe.Event);

    expect(users.get('u1')).toMatchObject({
      plan: 'pro',
      stripeSubscriptionId: 'sub_new',
    });
  });

  it('ignore les événements non liés à un abonnement', async () => {
    await service.handleEvent({
      id: 'evt_other',
      type: 'invoice.created',
      data: { object: {} },
    } as unknown as Stripe.Event);
    expect(retrieve).not.toHaveBeenCalled();
  });
});
