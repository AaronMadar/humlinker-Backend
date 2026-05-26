/**
 * Contact entity
 *
 * Représente un contact du téléphone d'un utilisateur.
 * Stocké en DB pour permettre la re-synchronisation automatique via
 * des événements (ex: un contact change son numéro ou s'inscrit sur Humlinker).
 *
 * ─── Normalisation ───────────────────────────────────────────────────────────
 *  phoneNumbers : tous les numéros sont normalisés en E.164 avant stockage
 *  emails       : tous les emails sont en minuscules avant stockage
 *
 * ─── matchedUserId ───────────────────────────────────────────────────────────
 *  null         → ce contact n'est pas encore inscrit sur Humlinker
 *  string (userId) → ce contact est un utilisateur Humlinker connu
 *
 *  Le champ est mis à jour automatiquement via EventEmitter quand un
 *  utilisateur s'inscrit ou modifie son email / téléphone.
 */

export interface Contact {
  _id: string;

  /** Propriétaire de ce contact (l'utilisateur qui a syncé son téléphone) */
  ownerId: string;

  /** Nom affiché dans le carnet de contacts du téléphone */
  name: string;

  /** Numéros de téléphone normalisés E.164 */
  phoneNumbers: string[];

  /** Emails en minuscules */
  emails: string[];

  /**
   * User Humlinker correspondant à ce contact.
   * null si le contact n'est pas encore inscrit.
   */
  matchedUserId: string | null;

  createdAt: Date;
  updatedAt: Date;
}
