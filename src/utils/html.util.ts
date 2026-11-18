/**
 * Échappe les caractères HTML spéciaux.
 * À utiliser pour TOUT contenu fourni par un utilisateur inséré dans un email HTML
 * (sinon : injection de liens/images/formulaires → phishing avec notre domaine).
 */
export function escapeHtml(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Retire les retours à la ligne (en-têtes d'email comme le sujet). */
export function singleLine(value: string | null | undefined): string {
  return (value ?? '').replace(/[\r\n]+/g, ' ').trim();
}
