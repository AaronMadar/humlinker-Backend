/**
 * Installation Stripe de Humlinker — idempotente (relançable sans créer de doublons).
 *
 * Crée ou retrouve, sur le compte de STRIPE_SECRET_KEY :
 *  - le produit « Humlinker Pro » et ses deux prix (mensuel, annuel), repérés
 *    par leurs lookup_keys, en EUR + autres devises (USD, GBP, ILS) ;
 *  - la configuration du portail client (résiliation en fin de période,
 *    changement de carte, factures, passage mensuel ↔ annuel).
 *
 *   npm run stripe:setup                → affiche les identifiants
 *   npm run stripe:setup -- --write-env → les écrit aussi dans .env
 *
 * Les montants se règlent ici (TTC, en centimes). Le montant EUR d'un prix
 * Stripe n'est pas modifiable : pour le changer, créer de nouveaux lookup_keys
 * (ex. humlinker_pro_monthly_v2). Les autres devises, elles, sont mises à jour
 * en relançant le script.
 *
 * En production : relancer avec la clé sk_live_ pour créer l'offre réelle.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import Stripe from 'stripe';

const PRODUCT = {
  name: 'Humlinker Pro',
  description:
    'Plus de reformulations IA, Humlinkers illimités et messages jusqu’à 4 000 caractères.',
  metadataKey: 'humlinker_plan',
  metadataValue: 'pro',
};

/**
 * Montants TTC en centimes. EUR = prix de référence. Les autres devises valent
 * le prix en euros au taux BCE, arrondi AU-DESSUS (jamais moins qu'en euros) :
 * mensuel au ,99 supérieur (,90 pour le shekel), annuel à l'unité supérieure.
 *   Taux BCE du 18/11/2026 : 1 € = 1,0968 $ = 0,8329 £ = 3,5798 ₪
 *   6,99 € → 7,67 $ → 7,99 $  |  5,82 £ → 5,99 £  |  25,02 ₪ → 25,90 ₪
 *   59 €   → 64,71 $ → 65 $   |  49,14 £ → 50 £   |  211,21 ₪ → 212 ₪
 * À revoir si les taux bougent fortement, puis relancer le script.
 *
 * Les autres devises sont attachées au MÊME prix (currency_options) ; Checkout
 * encaisse dans la devise envoyée par le front (selon la localisation du client,
 * dollar par défaut). Ajouter une devise = une entrée ici + relancer le script
 * (+ l'ajouter à SUPPORTED_CURRENCIES côté backend et à la détection du front).
 */
const PRICES = [
  {
    env: 'STRIPE_PRICE_PRO_MONTHLY',
    lookupKey: 'humlinker_pro_monthly',
    interval: 'month' as const,
    amount: 699,
    currencyOptions: { usd: 799, gbp: 599, ils: 2590 },
  },
  {
    env: 'STRIPE_PRICE_PRO_YEARLY',
    lookupKey: 'humlinker_pro_yearly',
    interval: 'year' as const,
    amount: 5900,
    currencyOptions: { usd: 6500, gbp: 5000, ils: 21200 },
  },
];
const CURRENCY = 'eur';
const PORTAL_METADATA = { humlinker_portal: 'v1' };

/** Offre proposée dans le portail : changement de formule, quantité fixée à 1. */
const PORTAL_PRODUCT = (product: string, prices: string[]) => ({
  product,
  prices,
  adjustable_quantity: { enabled: false },
});

const toCurrencyOptions = (opts: Record<string, number>) =>
  Object.fromEntries(
    Object.entries(opts).map(([cur, amount]) => [
      cur,
      { unit_amount: amount, tax_behavior: 'inclusive' as const },
    ]),
  );

async function findOrCreateProduct(stripe: Stripe): Promise<Stripe.Product> {
  // 1) Via un prix existant : fiable immédiatement (la recherche Stripe, elle,
  //    met jusqu'à une minute à indexer un objet tout juste créé)
  const byPrice = await stripe.prices.list({
    lookup_keys: PRICES.map((p) => p.lookupKey),
    active: true,
    limit: 10,
    expand: ['data.product'],
  });
  const fromPrice = byPrice.data
    .map((p) => p.product)
    .find(
      (prod): prod is Stripe.Product =>
        typeof prod === 'object' && !('deleted' in prod && prod.deleted),
    );
  if (fromPrice) {
    console.log(`✓ Produit existant : ${fromPrice.id}`);
    return fromPrice;
  }
  // 2) Liste (cohérente, contrairement à la recherche) filtrée par métadonnée
  for await (const prod of stripe.products.list({ active: true, limit: 100 })) {
    if (prod.metadata?.[PRODUCT.metadataKey] === PRODUCT.metadataValue) {
      console.log(`✓ Produit existant : ${prod.id}`);
      return prod;
    }
  }
  const product = await stripe.products.create({
    name: PRODUCT.name,
    description: PRODUCT.description,
    metadata: { [PRODUCT.metadataKey]: PRODUCT.metadataValue },
  });
  console.log(`+ Produit créé : ${product.id}`);
  return product;
}

async function findOrCreatePrice(
  stripe: Stripe,
  productId: string,
  p: (typeof PRICES)[number],
): Promise<Stripe.Price> {
  const found = await stripe.prices.list({
    lookup_keys: [p.lookupKey],
    active: true,
    limit: 1,
    expand: ['data.currency_options'],
  });
  const existing = found.data[0];
  if (existing) {
    const current = existing.currency_options ?? {};
    // Un montant déjà fixé (EUR ou autre devise) n'est PAS modifiable chez Stripe
    const changed =
      existing.unit_amount !== p.amount ||
      Object.entries(p.currencyOptions).some(
        ([cur, amount]) =>
          current[cur] !== undefined && current[cur].unit_amount !== amount,
      );
    if (!changed) {
      // Seules des devises nouvelles manquent : on peut les ajouter au prix existant
      const missing = Object.keys(p.currencyOptions).filter((c) => !current[c]);
      if (missing.length) {
        await stripe.prices.update(existing.id, {
          currency_options: toCurrencyOptions(p.currencyOptions),
        });
        console.log(
          `~ ${p.lookupKey} : devises ajoutées (${missing.join(', ')})`,
        );
      }
      console.log(`✓ Prix existant ${p.lookupKey} : ${existing.id}`);
      return existing;
    }
    // Montant modifié → nouveau prix qui reprend le lookup_key, ancien archivé.
    // Les abonnés existants gardent leur ancien tarif (comportement Stripe normal).
    const price = await createPrice(stripe, productId, p, true);
    await stripe.prices.update(existing.id, { active: false });
    console.log(
      `↻ ${p.lookupKey} : montants modifiés → nouveau prix ${price.id} (ancien ${existing.id} archivé)`,
    );
    return price;
  }
  const price = await createPrice(stripe, productId, p, false);
  console.log(
    `+ Prix créé ${p.lookupKey} (${p.amount / 100} €/${p.interval} + ${Object.keys(p.currencyOptions).join(', ')}) : ${price.id}`,
  );
  return price;
}

function createPrice(
  stripe: Stripe,
  productId: string,
  p: (typeof PRICES)[number],
  transferLookupKey: boolean,
): Promise<Stripe.Price> {
  return stripe.prices.create({
    product: productId,
    currency: CURRENCY,
    unit_amount: p.amount,
    recurring: { interval: p.interval },
    lookup_key: p.lookupKey,
    transfer_lookup_key: transferLookupKey,
    // Prix affichés TTC (B2C)
    tax_behavior: 'inclusive',
    currency_options: toCurrencyOptions(p.currencyOptions),
    nickname: `Humlinker Pro — ${p.interval === 'month' ? 'mensuel' : 'annuel'}`,
  });
}

async function findOrCreatePortal(
  stripe: Stripe,
  productId: string,
  priceIds: string[],
): Promise<Stripe.BillingPortal.Configuration> {
  const configs = await stripe.billingPortal.configurations.list({
    active: true,
    limit: 100,
  });
  const match = configs.data.find(
    (c) => c.metadata?.humlinker_portal === PORTAL_METADATA.humlinker_portal,
  );
  // La liste des prix proposés n'est renvoyée que sur demande (expand)
  const existing = match
    ? await stripe.billingPortal.configurations.retrieve(match.id, {
        expand: ['features.subscription_update.products'],
      })
    : undefined;
  if (existing) {
    // Le portail doit proposer les prix ACTUELS (passage mensuel ↔ annuel)
    const offered =
      existing.features.subscription_update.products?.[0]?.prices ?? [];
    const quantityLocked =
      existing.features.subscription_update.products?.[0]?.adjustable_quantity
        ?.enabled === false;
    const upToDate =
      quantityLocked &&
      offered.length === priceIds.length &&
      priceIds.every((id) => offered.includes(id));
    if (!upToDate) {
      const updated = await stripe.billingPortal.configurations.update(
        existing.id,
        {
          features: {
            subscription_update: {
              products: [PORTAL_PRODUCT(productId, priceIds)],
            },
          },
        },
      );
      console.log(
        `~ Portail client : prix proposés mis à jour (${updated.id})`,
      );
      return updated;
    }
    console.log(`✓ Portail client existant : ${existing.id}`);
    return existing;
  }
  const portal = await stripe.billingPortal.configurations.create({
    name: 'Humlinker',
    metadata: PORTAL_METADATA,
    business_profile: { headline: 'Humlinker — gérer mon abonnement Pro' },
    features: {
      customer_update: {
        enabled: true,
        allowed_updates: ['email', 'name', 'address'],
      },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        // Pro reste actif jusqu'à la fin de la période déjà payée
        mode: 'at_period_end',
        cancellation_reason: {
          enabled: true,
          options: ['too_expensive', 'missing_features', 'unused', 'other'],
        },
      },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price'],
        products: [PORTAL_PRODUCT(productId, priceIds)],
        proration_behavior: 'create_prorations',
      },
    },
  });
  console.log(`+ Portail client créé : ${portal.id}`);
  return portal;
}

/** Remplace ou ajoute des lignes KEY=valeur dans .env sans toucher au reste. */
function writeEnv(values: Record<string, string>): void {
  const file = path.join(process.cwd(), '.env');
  let content = fs.readFileSync(file, 'utf8');
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    content = re.test(content)
      ? content.replace(re, line)
      : `${content.replace(/\s*$/, '')}\n${line}\n`;
  }
  fs.writeFileSync(file, content);
  console.log(`\n.env mis à jour : ${Object.keys(values).join(', ')}`);
}

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error('STRIPE_SECRET_KEY absente du .env');
  const mode = key.startsWith('sk_live_') ? 'RÉEL (live)' : 'test';
  console.log(`Stripe — mode ${mode}\n`);

  const stripe = new Stripe(key);
  const product = await findOrCreateProduct(stripe);
  const prices: Stripe.Price[] = [];
  for (const p of PRICES)
    prices.push(await findOrCreatePrice(stripe, product.id, p));
  const portal = await findOrCreatePortal(
    stripe,
    product.id,
    prices.map((p) => p.id),
  );

  const values: Record<string, string> = {
    STRIPE_PRICE_PRO_MONTHLY: prices[0].id,
    STRIPE_PRICE_PRO_YEARLY: prices[1].id,
    STRIPE_PORTAL_CONFIGURATION_ID: portal.id,
  };
  console.log('\nIdentifiants :');
  for (const [k, v] of Object.entries(values)) console.log(`  ${k}=${v}`);

  if (process.argv.includes('--write-env')) writeEnv(values);
  else console.log('\nAjoutez-les au .env (ou relancez avec --write-env).');
}

main().catch((e: Error) => {
  console.error(`Erreur : ${e.message}`);
  process.exit(1);
});
