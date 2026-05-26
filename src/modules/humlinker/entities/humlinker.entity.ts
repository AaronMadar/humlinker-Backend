/**
 * Humlinker entity
 *
 * Représente un humlinker — l'espace de communication AI entre deux personnes.
 * Chaque humlinker a un miroir côté destinataire (mirrorId).
 *
 * ─── Statuts ───────────────────────────────────────────────────────────────
 *  pending  : créé, aucun message encore envoyé au destinataire
 *  active   : au moins un message a été envoyé
 *  archived : archivé par l'utilisateur (masqué de la liste principale)
 *  blocked  : bloqué — les deux côtés (humlinker + mirror) sont figés
 */

export type HumlinkerStatus = 'pending' | 'active' | 'archived' | 'blocked';

export type HumlinkerChannel = 'app' | 'sms' | 'whatsapp' | 'email';

export interface Humlinker {
  _id: string;

  /** Utilisateur qui a créé le humlinker */
  senderId: string;
  /** Utilisateur destinataire (réel ou placeholder) */
  targetId: string;

  /**
   * ID du humlinker miroir (côté target).
   * Null lors de la création, mis à jour juste après la création du mirror.
   */
  mirrorId: string | null;

  status: HumlinkerStatus;
  /** userId de la personne qui a bloqué (null si non bloqué) */
  blockedBy: string | null;

  /** Canal de communication choisi par le créateur */
  communicationChannel: HumlinkerChannel;

  /** Nom du contact tel que saisi par le créateur */
  targetContactName: string;
  /** Email brut saisi par le créateur */
  targetContactEmail: string | null;
  /** Téléphone normalisé E.164 saisi par le créateur */
  targetContactPhone: string | null;

  /** Type de relation décrit par le créateur (ex: "collègue", "ami") */
  relationshipType: string;
  /** Titre donné au humlinker */
  title: string;

  /** Langue du créateur */
  creatorLanguage: string;
  /** Langue du destinataire (connue si target déjà inscrit, sinon null) */
  targetLanguage: string | null;

  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
