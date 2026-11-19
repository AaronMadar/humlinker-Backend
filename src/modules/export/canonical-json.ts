import { createHash } from 'crypto';

/**
 * Sérialisation JSON canonique : clés d'objets triées (ordre des points de code),
 * aucun espace, tableaux dans leur ordre, valeurs `undefined` omises.
 * Deux contenus identiques donnent toujours la même chaîne, donc la même empreinte.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/** SHA-256 (hexadécimal, minuscules) de la sérialisation canonique, encodée en UTF-8. */
export function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
