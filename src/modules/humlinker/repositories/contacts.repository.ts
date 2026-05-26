/**
 * ContactsRepository — interface du repository contacts.
 *
 * Gère le stockage et la recherche des contacts synchronisés depuis
 * le téléphone de l'utilisateur.
 */
import type { Contact } from '../entities';

export const CONTACTS_REPOSITORY = Symbol('CONTACTS_REPOSITORY');

// ─── Types d'entrée ────────────────────────────────────────────────────────

export interface UpsertContactData {
  ownerId: string;
  name: string;
  /** Numéros déjà normalisés E.164 */
  phoneNumbers: string[];
  /** Emails déjà en minuscules */
  emails: string[];
  matchedUserId?: string | null;
}

export interface ContactsRepository {
  /**
   * Upsert d'un contact.
   * La clé d'unicité est (ownerId, name).
   * Met à jour les phoneNumbers, emails et matchedUserId si le contact existe.
   */
  upsert(data: UpsertContactData): Promise<Contact>;

  /**
   * Upsert en masse — utilisé lors de la synchronisation initiale.
   * Retourne les contacts mis à jour avec leur matchedUserId.
   */
  upsertMany(data: UpsertContactData[]): Promise<Contact[]>;

  /**
   * Retourne tous les contacts d'un utilisateur.
   * matchedUserId non null = inscrit sur Humlinker (en haut de liste côté front).
   */
  findAllByOwner(ownerId: string): Promise<Contact[]>;

  /**
   * Trouve tous les contacts qui ont ce userId comme matchedUserId.
   * Utilisé lors du trigger de re-sync pour notifier les propriétaires
   * que leur contact a mis à jour ses coordonnées.
   */
  findByMatchedUserId(userId: string): Promise<Contact[]>;

  /**
   * Met à jour matchedUserId pour tous les contacts qui ont
   * ce phoneNumber ou cet email dans leurs tableaux.
   * Appelé via EventEmitter quand un utilisateur s'inscrit ou change ses coordonnées.
   */
  updateMatchByPhoneOrEmail(
    userId: string,
    phones: string[],
    emails: string[],
  ): Promise<number>;

  /**
   * Retire matchedUserId des contacts qui pointaient vers cet userId
   * et dont les coordonnées ne correspondent plus.
   * Utile si un utilisateur change son numéro/email.
   */
  clearStaleMatches(
    userId: string,
    currentPhones: string[],
    currentEmails: string[],
  ): Promise<void>;
}
