/**
 * ChatMessage entity
 *
 * Représente un message dans le chat d'un humlinker.
 *
 * ─── Rôles ───────────────────────────────────────────────────────────────────
 *  user   : message envoyé par l'utilisateur à l'IA
 *  ai     : réponse de l'IA
 *  system : message système (modération, notifications automatiques)
 *
 * ─── Types ───────────────────────────────────────────────────────────────────
 *  text           : message texte standard
 *  draft_snapshot : ancienne version de draft (grisée dans le chat, non interactive)
 *  system         : message système affiché dans le fil de conversation
 *  target_reply   : réponse brute du target stockée dans le chat du sender
 *  real_message   : realMessage reçu du sender (affiché à GAUCHE dans le chat du destinataire)
 *
 * ─── Affichage dans le chat (ordre chronologique, style WhatsApp) ──────────
 *  - Messages "user" et "ai" : bulles de conversation normales
 *  - Messages "draft_snapshot" : carte grisée affichant l'objectiveMessage
 *    de l'ancienne version (sans boutons)
 *  - Messages "system" : texte centré (ex: "Ce type de message est interdit.")
 */

export type ChatMessageRole = 'user' | 'ai' | 'system';

export type ChatMessageType = 'text' | 'draft_snapshot' | 'system' | 'target_reply' | 'real_message';

export interface ChatMessage {
  _id: string;

  /** ID du humlinker auquel appartient ce message */
  humhlinkerId: string;

  role: ChatMessageRole;
  type: ChatMessageType;

  /** Contenu textuel du message */
  content: string;

  /**
   * ID du Draft lié — uniquement quand type = 'draft_snapshot'.
   * Permet d'afficher l'objectiveMessage de l'ancienne version.
   */
  draftId: string | null;

  createdAt: Date;
}
