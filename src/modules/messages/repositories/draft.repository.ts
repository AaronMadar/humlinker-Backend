/**
 * DraftRepository — interface du repository des drafts.
 *
 * Un draft représente une version du message préparé par l'IA.
 * Chaque itération crée une nouvelle version (version++).
 *
 * ─── Règles ───────────────────────────────────────────────────────────────
 *  - Un seul draft actif par humlinker : isSent = false, version = max
 *  - Après Send : isSent = true → nouveau draft vide créé automatiquement
 *  - Le realMessage n'est JAMAIS exposé au sender (filtré côté service)
 */
import type { Draft } from '../../humlinker/entities';

export const DRAFT_REPOSITORY = Symbol('DRAFT_REPOSITORY');

export interface DraftRepository {
  /**
   * Retourne le draft actif (isSent = false, version la plus haute).
   * null si aucun draft actif.
   */
  findActiveDraft(humhlinkerId: string): Promise<Draft | null>;

  /**
   * Retourne les N derniers drafts envoyés (isSent = true).
   * Utilisés comme contexte pour l'IA.
   */
  findLastSentDrafts(humhlinkerId: string, limit: number): Promise<Draft[]>;

  /** Crée un nouveau draft */
  create(data: CreateDraftData): Promise<Draft>;

  /** Met à jour un draft existant (objectiveMessage + realMessage) */
  update(id: string, data: UpdateDraftData): Promise<Draft | null>;

  /** Marque un draft comme envoyé */
  markAsSent(id: string): Promise<Draft | null>;
}

export interface CreateDraftData {
  humhlinkerId: string;
  objectiveMessage: string;
  realMessage: string;
  version: number;
  isSent?: boolean;
}

export interface UpdateDraftData {
  objectiveMessage?: string;
  realMessage?: string;
}
