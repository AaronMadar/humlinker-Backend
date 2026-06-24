/**
 * Humlinker entity
 *
 * Represente un humlinker - l'espace de communication AI entre deux personnes.
 * Chaque humlinker a un miroir cote destinataire (mirrorId).
 *
 * Statuts :
 *  pending  : cree, aucun message encore envoye au destinataire
 *  active   : au moins un message a ete envoye
 *  archived : archive par l'utilisateur (masque de la liste principale)
 *  blocked  : bloque - les deux cotes (humlinker + mirror) sont figes
 *
 * Snapshots :
 *  sender / target : copie des donnees du profil au moment de la creation.
 *  Permet d'acceder a toutes les infos (nom, langue, photo...) sans fetch
 *  supplementaire. Mis a jour quand un placeholder cree son vrai compte.
 */

export type HumlinkerStatus = 'pending' | 'active' | 'archived' | 'blocked';

export type HumlinkerChannel = 'app' | 'email';

export interface HumlinkerParticipant {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  language: string;
  gender: 'male' | 'female' | 'other' | null;
  profilePicture: string | null;
  isPlaceholder: boolean;
}

export interface Humlinker {
  _id: string;

  /**
   * IDs conserves pour les FK en base et les lookups directs.
   * Les donnees completes sont dans les snapshots sender/target.
   */
  senderId: string;
  targetId: string;

  /**
   * ID du humlinker miroir (cote target).
   * Null lors de la creation, mis a jour juste apres la creation du mirror.
   */
  mirrorId: string | null;

  /**
   * true  = record de l'initiateur (celui qui a créé l'invitation)
   * false = record miroir du destinataire (celui qui a reçu l'invitation)
   */
  isInitiator: boolean;

  status: HumlinkerStatus;
  /** userId de la personne qui a bloque (null si non bloque) */
  blockedBy: string | null;

  /** Canal de communication choisi par le createur */
  communicationChannel: HumlinkerChannel;

  /**
   * Nom affiche du target tel que saisi par le createur.
   * Independant du vrai nom dans le snapshot - chaque sender a son propre label.
   */
  targetContactName: string;

  /** Type de relation decrit par le createur (ex: "collegue", "ami") */
  relationshipType: string;
  /** Titre donne au humlinker */
  title: string;

  /** Snapshot complet du sender au moment de la creation */
  sender: HumlinkerParticipant;
  /** Snapshot complet du target au moment de la creation */
  target: HumlinkerParticipant;

  lastActivityAt: Date;
  /** Contenu du dernier real_message (preview sidebar) */
  lastMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}
