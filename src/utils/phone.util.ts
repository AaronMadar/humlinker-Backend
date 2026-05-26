/**
 * phone.util.ts
 *
 * Normalisation des numéros de téléphone au format E.164 (+33612345678).
 *
 * Utilise libphonenumber-js pour le parsing strict.
 * En cas d'échec (numéro non reconnu), applique un fallback basique :
 * ne garde que les chiffres et préfixe avec "+".
 *
 * Usage :
 *   normalizePhone('+33 6 12 34 56 78')  → '+33612345678'
 *   normalizePhone('06 12 34 56 78', 'FR') → '+33612345678'
 *   normalizePhones(['+33612345678', '0612345678'], 'FR') → ['+33612345678', '+33612345678']
 */
import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';

/**
 * Normalise un numéro de téléphone au format E.164.
 *
 * @param phone     - Numéro brut saisi par l'utilisateur
 * @param countryCode - Code pays ISO 3166-1 alpha-2 (ex: 'FR', 'US') utilisé
 *                    comme contexte si le numéro est local (sans +)
 * @returns         - Numéro au format E.164 (ex: '+33612345678')
 *                    Retourne null si le numéro ne peut pas être normalisé
 */
export function normalizePhone(
  phone: string,
  countryCode?: string,
): string | null {
  if (!phone || !phone.trim()) return null;

  const cleaned = phone.trim();

  try {
    // Tentative avec libphonenumber-js
    const parsed = parsePhoneNumber(
      cleaned,
      countryCode as Parameters<typeof parsePhoneNumber>[1],
    );
    if (parsed && parsed.isValid()) {
      return parsed.format('E.164');
    }
  } catch {
    // parsePhoneNumber lève une exception pour certains formats invalides
  }

  // Fallback : si le numéro contient déjà un "+" on garde les chiffres après
  // Sinon on retourne null — on refuse les numéros vraiment invalides
  const digitsOnly = cleaned.replace(/\D/g, '');
  if (cleaned.startsWith('+') && digitsOnly.length >= 7 && digitsOnly.length <= 15) {
    return `+${digitsOnly}`;
  }

  return null;
}

/**
 * Normalise un tableau de numéros de téléphone.
 * Les numéros invalides (null retourné par normalizePhone) sont filtrés.
 *
 * @param phones      - Tableau de numéros bruts
 * @param countryCode - Code pays ISO 3166-1 alpha-2 par défaut
 * @returns           - Tableau de numéros E.164 dédupliqués et valides
 */
export function normalizePhones(
  phones: string[],
  countryCode?: string,
): string[] {
  const normalized = phones
    .map((p) => normalizePhone(p, countryCode))
    .filter((p): p is string => p !== null);

  // Déduplique
  return [...new Set(normalized)];
}

/**
 * Valide strictement un numéro au format E.164.
 * Utilisé avant d'enregistrer en DB.
 */
export function isE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}
