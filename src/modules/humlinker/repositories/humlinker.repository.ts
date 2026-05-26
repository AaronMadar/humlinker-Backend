/**
 * HumlinkerRepository — interface du repository humlinker.
 *
 * Toutes les requêtes DB liées aux humlinkers passent par cette interface.
 * L'implémentation concrète (Prisma) est dans prisma-humlinker.repository.ts.
 */
import type { Humlinker, HumlinkerStatus } from '../entities';

export const HUMLINKER_REPOSITORY = Symbol('HUMLINKER_REPOSITORY');

// ─── Types d'entrée ────────────────────────────────────────────────────────

export interface CreateHumlinkerData {
  senderId: string;
  targetId: string;
  mirrorId?: string | null;
  status?: HumlinkerStatus;
  communicationChannel: Humlinker['communicationChannel'];
  targetContactName: string;
  targetContactEmail?: string | null;
  targetContactPhone?: string | null;
  relationshipType: string;
  title: string;
  creatorLanguage: string;
  targetLanguage?: string | null;
}

export interface UpdateHumlinkerData {
  mirrorId?: string | null;
  status?: HumlinkerStatus;
  blockedBy?: string | null;
  targetLanguage?: string | null;
  lastActivityAt?: Date;
  twilioConversationSid?: string | null;
}

export interface HumlinkerRepository {
  /** Trouve un humlinker par son ID */
  findById(id: string): Promise<Humlinker | null>;

  /**
   * Récupère tous les humlinkers d'un utilisateur (sender OU target),
   * triés par lastActivityAt DESC (style WhatsApp).
   * Supporte le lazy load : offset + limit.
   */
  findAllByUserId(
    userId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<Humlinker[]>;

  /**
   * Trouve le humlinker entre deux utilisateurs (dans un sens donné).
   * Utilisé pour vérifier qu'un humlinker n'existe pas déjà.
   */
  findBySenderAndTarget(
    senderId: string,
    targetId: string,
  ): Promise<Humlinker | null>;

  /** Crée un nouveau humlinker */
  create(data: CreateHumlinkerData): Promise<Humlinker>;

  /** Met à jour un humlinker */
  update(id: string, data: UpdateHumlinkerData): Promise<Humlinker | null>;

  /**
   * Trouve un humlinker via son SID de Conversation Twilio.
   * Utilisé pour router les webhooks entrants au bon humlinker.
   */
  findByTwilioConversationSid(sid: string): Promise<Humlinker | null>;

  /**
   * Bloque un humlinker ET son mirror en une seule opération (transaction).
   * Les deux passent en status 'blocked', blockedBy = userId.
   */
  blockBoth(humhlinkerId: string, mirrorId: string, blockedBy: string): Promise<void>;
}
