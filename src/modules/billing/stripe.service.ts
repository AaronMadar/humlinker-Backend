/**
 * StripeService — abonnement Pro via Stripe Checkout + Customer Portal + webhooks.
 *
 * Principes :
 *  - La source de vérité de l'abonnement est Stripe. Le backend ne fait que
 *    RECOPIER l'état de l'abonnement dans users (plan, planExpiresAt…).
 *  - Chaque webhook relit l'abonnement depuis l'API Stripe : l'ordre d'arrivée
 *    des événements n'a pas d'importance et un événement rejoué est sans effet.
 *  - Signature des webhooks vérifiée (STRIPE_WEBHOOK_SECRET) sur le corps brut.
 *  - Si Stripe n'est pas configuré (dev), les routes répondent 503 proprement.
 *
 * Accès Pro selon le statut Stripe :
 *  - active / trialing → Pro jusqu'à la fin de période (+ marge pour le renouvellement)
 *  - past_due (renouvellement impayé, Stripe réessaie) → Pro seulement pendant
 *    PAST_DUE_GRACE_DAYS après le début de la nouvelle période, puis free
 *  - canceled, unpaid, incomplete, incomplete_expired, paused → free
 */
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../database';
import { getAllowedOrigins } from '../../config/env.validation';

export type BillingInterval = 'month' | 'year';

/** Marge après la fin de période pour laisser le temps au renouvellement d'arriver. */
const RENEWAL_GRACE_DAYS = 2;
/** Délai d'accès Pro maintenu quand le paiement du renouvellement échoue. */
const PAST_DUE_GRACE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const PRICES_CACHE_MS = 60 * 60 * 1000;

export interface PublicPrice {
  interval: BillingInterval;
  amount: number; // en centimes
  currency: string;
}

export interface SubscriptionSnapshot {
  plan: 'free' | 'pro';
  planExpiresAt: Date | null;
  subscriptionStatus: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}

/**
 * Traduit un abonnement Stripe en état d'accès Humlinker.
 * Fonction pure → testée unitairement sans Stripe.
 */
export function snapshotFromSubscription(
  sub: Pick<Stripe.Subscription, 'status' | 'cancel_at_period_end' | 'items'>,
): SubscriptionSnapshot {
  const item = sub.items?.data?.[0];
  const periodStart = item?.current_period_start
    ? new Date(item.current_period_start * 1000)
    : null;
  const periodEnd = item?.current_period_end
    ? new Date(item.current_period_end * 1000)
    : null;

  const base = {
    subscriptionStatus: sub.status,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
  };

  if ((sub.status === 'active' || sub.status === 'trialing') && periodEnd) {
    // Résiliation demandée : pas de marge, l'accès s'arrête pile en fin de période
    const grace = sub.cancel_at_period_end ? 0 : RENEWAL_GRACE_DAYS * DAY_MS;
    return {
      ...base,
      plan: 'pro',
      planExpiresAt: new Date(periodEnd.getTime() + grace),
    };
  }

  if (sub.status === 'past_due' && periodStart) {
    return {
      ...base,
      plan: 'pro',
      planExpiresAt: new Date(
        periodStart.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS,
      ),
    };
  }

  return { ...base, plan: 'free', planExpiresAt: null };
}

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe | null;
  private pricesCache: { at: number; prices: PublicPrice[] } | null = null;

  constructor(private readonly prisma: PrismaService) {
    const key = process.env.STRIPE_SECRET_KEY?.trim();
    this.stripe = key ? new Stripe(key) : null;
    if (!this.stripe) {
      this.logger.warn('STRIPE_SECRET_KEY absent — paiement désactivé.');
    }
  }

  get enabled(): boolean {
    return !!this.stripe && !!this.priceId('month');
  }

  private client(): Stripe {
    if (!this.stripe) {
      throw new HttpException(
        {
          message: 'Le paiement est momentanément indisponible.',
          code: 'BILLING_DISABLED',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.stripe;
  }

  private priceId(interval: BillingInterval): string | undefined {
    const id =
      interval === 'year'
        ? process.env.STRIPE_PRICE_PRO_YEARLY
        : process.env.STRIPE_PRICE_PRO_MONTHLY;
    return id?.trim() || undefined;
  }

  private frontendUrl(): string {
    return getAllowedOrigins()[0] ?? 'http://localhost:5173';
  }

  // ─── Tarifs affichés dans le front ────────────────────────────────────────

  async getPrices(): Promise<PublicPrice[]> {
    if (!this.enabled) return [];
    if (
      this.pricesCache &&
      Date.now() - this.pricesCache.at < PRICES_CACHE_MS
    ) {
      return this.pricesCache.prices;
    }
    const prices: PublicPrice[] = [];
    for (const interval of ['month', 'year'] as const) {
      const id = this.priceId(interval);
      if (!id) continue;
      const price = await this.client().prices.retrieve(id);
      if (price.unit_amount !== null && price.unit_amount !== undefined) {
        prices.push({
          interval,
          amount: price.unit_amount,
          currency: price.currency,
        });
      }
    }
    this.pricesCache = { at: Date.now(), prices };
    return prices;
  }

  // ─── Checkout ─────────────────────────────────────────────────────────────

  async createCheckoutSession(
    userId: string,
    interval: BillingInterval,
  ): Promise<string> {
    const stripe = this.client();
    const price = this.priceId(interval);
    if (!price) throw new BadRequestException('Formule indisponible.');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    if (
      user.stripeSubscriptionId &&
      ['active', 'trialing', 'past_due'].includes(user.subscriptionStatus ?? '')
    ) {
      throw new ConflictException(
        'Vous avez déjà un abonnement Pro. Gérez-le depuis « Gérer mon abonnement ».',
      );
    }

    const customerId = await this.ensureCustomer(stripe, user);
    const front = this.frontendUrl();

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: userId,
      line_items: [{ price, quantity: 1 }],
      allow_promotion_codes: true,
      customer_update: { address: 'auto', name: 'auto' },
      subscription_data: { metadata: { userId } },
      metadata: { userId },
      success_url: `${front}/app/profile?checkout=success`,
      cancel_url: `${front}/app/profile?checkout=cancel`,
    });

    if (!session.url)
      throw new HttpException(
        'Session de paiement invalide.',
        HttpStatus.BAD_GATEWAY,
      );
    return session.url;
  }

  private async ensureCustomer(
    stripe: Stripe,
    user: {
      id: string;
      email: string | null;
      firstName: string | null;
      lastName: string | null;
      stripeCustomerId: string | null;
    },
  ): Promise<string> {
    if (user.stripeCustomerId) return user.stripeCustomerId;

    const customer = await stripe.customers.create(
      {
        email: user.email ?? undefined,
        name:
          [user.firstName, user.lastName].filter(Boolean).join(' ') ||
          undefined,
        metadata: { userId: user.id },
      },
      // Deux clics simultanés ne créent pas deux clients Stripe
      { idempotencyKey: `humlinker-customer-${user.id}` },
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customer.id },
    });
    return customer.id;
  }

  // ─── Portail client (gérer / résilier / changer de carte / factures) ──────

  async createPortalSession(userId: string): Promise<string> {
    const stripe = this.client();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.stripeCustomerId) {
      throw new BadRequestException("Aucun abonnement à gérer pour l'instant.");
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${this.frontendUrl()}/app/profile`,
    });
    return session.url;
  }

  // ─── Webhooks ─────────────────────────────────────────────────────────────

  /** Vérifie la signature et retourne l'événement. Lève 400 si invalide. */
  constructEvent(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Stripe.Event {
    const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!secret) {
      throw new HttpException(
        'Webhook Stripe non configuré.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!rawBody || !signature) {
      throw new BadRequestException('Signature Stripe manquante.');
    }
    try {
      return this.client().webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      this.logger.warn(`Webhook Stripe rejeté : ${(err as Error).message}`);
      throw new BadRequestException('Signature Stripe invalide.');
    }
  }

  async handleEvent(event: Stripe.Event): Promise<void> {
    const subscriptionId = this.subscriptionIdFromEvent(event);
    if (subscriptionId) {
      // checkout.session.completed : relier le client Stripe à l'utilisateur si besoin
      if (event.type === 'checkout.session.completed') {
        await this.linkCustomerFromCheckout(event.data.object);
      }
      await this.syncSubscription(subscriptionId);
    }

    await this.prisma.stripeEvent.upsert({
      where: { id: event.id },
      create: { id: event.id, type: event.type },
      update: {},
    });
  }

  private subscriptionIdFromEvent(event: Stripe.Event): string | null {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription' || !session.subscription)
          return null;
        return typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription.id;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed':
        return event.data.object.id;
      default:
        return null;
    }
  }

  private async linkCustomerFromCheckout(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const userId = session.client_reference_id ?? session.metadata?.userId;
    const customerId =
      typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id;
    if (!userId || !customerId) return;
    await this.prisma.user.updateMany({
      where: { id: userId, stripeCustomerId: null },
      data: { stripeCustomerId: customerId },
    });
  }

  /** Relit l'abonnement chez Stripe et recopie son état sur l'utilisateur. */
  async syncSubscription(subscriptionId: string): Promise<void> {
    const sub = await this.client().subscriptions.retrieve(subscriptionId);
    const customerId =
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

    const user =
      (await this.prisma.user.findUnique({
        where: { stripeCustomerId: customerId },
      })) ??
      (sub.metadata?.userId
        ? await this.prisma.user.findUnique({
            where: { id: sub.metadata.userId },
          })
        : null);

    if (!user) {
      this.logger.error(
        `Abonnement ${sub.id} : aucun utilisateur pour le client ${customerId}`,
      );
      return;
    }

    // Un ancien abonnement terminé ne doit pas écraser un abonnement plus récent
    if (
      user.stripeSubscriptionId &&
      user.stripeSubscriptionId !== sub.id &&
      ['active', 'trialing', 'past_due'].includes(
        user.subscriptionStatus ?? '',
      ) &&
      !['active', 'trialing', 'past_due'].includes(sub.status)
    ) {
      this.logger.log(
        `Abonnement ${sub.id} (${sub.status}) ignoré : ${user.stripeSubscriptionId} est actif`,
      );
      return;
    }

    const snap = snapshotFromSubscription(sub);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        stripeCustomerId: user.stripeCustomerId ?? customerId,
        stripeSubscriptionId: sub.id,
        ...snap,
      },
    });
    this.logger.log(
      `Utilisateur ${user.id} → ${snap.plan} (Stripe ${sub.status})`,
    );
  }
}
