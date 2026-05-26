/**
 * Draft entity
 *
 * Représente une version du message préparé par l'IA.
 * Chaque itération (l'utilisateur affine son message dans le chat) crée
 * une nouvelle version avec un numéro de version incrémenté.
 *
 * ─── Confidentialité ────────────────────────────────────────────────────────
 *  objectiveMessage : résumé visible par le créateur ("Vous souhaitez remercier Philippe…")
 *  realMessage      : message diplomatique généré par l'IA, envoyé au target.
 *                     Le créateur NE voit JAMAIS ce champ.
 */

export interface Draft {
  _id: string;

  /** ID du humlinker auquel ce draft appartient */
  humhlinkerId: string;

  /** Résumé de l'intention du créateur — visible dans le chat */
  objectiveMessage: string;

  /**
   * Message reformulé diplomatiquement par l'IA.
   * Transmis au target lors du clic "Send".
   * Jamais exposé au créateur.
   */
  realMessage: string;

  /** Numéro de version (1, 2, 3…) — auto-incrémenté par le service */
  version: number;

  /** true une fois que le créateur a cliqué "Send" */
  isSent: boolean;

  createdAt: Date;
}
