/**
 * Draft entity
 *
 * Représente une version du message préparé par l'IA.
 * Chaque itération (l'utilisateur affine son message dans le chat) crée
 * une nouvelle version avec un numéro de version incrémenté.
 *
 * ─── Confidentialité ────────────────────────────────────────────────────────
 *  objectiveMessage : intention consolidée (usage interne de l'IA)
 *  realMessage      : message diplomatique envoyé au target (langue du target)
 *  senderPreview    : ce même message dans la langue du créateur — c'est ce
 *                     qu'il voit avant d'envoyer (« Voici ce que je vais transmettre »)
 */

export interface Draft {
  _id: string;

  /** ID du humlinker auquel ce draft appartient */
  humhlinkerId: string;

  /** Résumé de l'intention du créateur — visible dans le chat */
  objectiveMessage: string;

  /** Message reformulé par l'IA, transmis au target lors du clic "Send" */
  realMessage: string;

  /** realMessage dans la langue du créateur (identique si même langue) */
  senderPreview: string;

  /** Numéro de version (1, 2, 3…) — auto-incrémenté par le service */
  version: number;

  /** true une fois que le créateur a cliqué "Send" */
  isSent: boolean;

  createdAt: Date;
}
