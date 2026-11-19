/**
 * Installation Stripe de Humlinker — idempotente (relançable sans créer de doublons).
 *
 * Crée ou retrouve, sur le compte de STRIPE_SECRET_KEY :
 *  - le produit « Humlinker Pro » et ses deux prix (mensuel, annuel), repérés
 *    par leurs lookup_keys ;
 *  - la configuration du portail client (résiliation en fin de période,
 *    changement de carte, factures, passage mensuel ↔ annuel).
 *
 *   npm run stripe:setup               → affiche les identifiants
 *   npm run stripe:setup -- --write-env → les écrit aussi dans .env
 *
 * Les montants se règlent ici (TTC, en centimes). Un prix Stripe n'est pas
 * modifiable : pour changer un montant, créer de nouveaux lookup_keys
 * (ex. humlinker_pro_monthly_v2) et relancer le script.
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

const PRICES = [
  {
    env: 'STRIPE_PRICE_PRO_MONTHLY',
    lookupKey: 'humlinker_pro_monthly',
    amount: 699,
    interval: 'month' as const,
  },
  {
    env: 'STRIPE_PRICE_PRO_YEARLY',
    lookupKey: 'humlinker_pro_yearly',
    amount: 5900,
    interval: 'year' as const,
  },
];
const CURRENCY = 'eur';
const PORTAL_METADATA = { humlinker_portal: 'v1' };

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
  });
  if (found.data[0]) {
    const existing = found.data[0];
    if (existing.unit_amount !== p.amount) {
      console.warn(
        `⚠ ${p.lookupKey} existe déjà à ${existing.unit_amount} centimes (demandé : ${p.amount}). ` +
          `Un prix Stripe n'est pas modifiable : créez un nouveau lookup_key pour changer le montant.`,
      );
    }
    console.log(`✓ Prix existant ${p.lookupKey} : ${existing.id}`);
    return existing;
  }
  const price = await stripe.prices.create({
    product: productId,
    currency: CURRENCY,
    unit_amount: p.amount,
    recurring: { interval: p.interval },
    lookup_key: p.lookupKey,
    // Prix affichés TTC (B2C, France)
    tax_behavior: 'inclusive',
    nickname: `Humlinker Pro — ${p.interval === 'month' ? 'mensuel' : 'annuel'}`,
  });
  console.log(
    `+ Prix créé ${p.lookupKey} (${p.amount / 100} €/${p.interval}) : ${price.id}`,
  );
  return price;
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
  const existing = configs.data.find(
    (c) => c.metadata?.humlinker_portal === PORTAL_METADATA.humlinker_portal,
  );
  if (existing) {
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
        products: [{ product: productId, prices: priceIds }],
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
