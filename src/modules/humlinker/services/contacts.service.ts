/**
 * ContactsService
 *
 * Gère la synchronisation des contacts téléphone avec la base Humlinker.
 *
 * ─── Responsabilités ─────────────────────────────────────────────────────────
 *  1. syncContacts() : reçoit les contacts bruts du front, normalise, upsert en DB,
 *     fait le matching avec les utilisateurs Humlinker existants, retourne la liste
 *     triée (matchés en haut, non matchés en bas avec option "Inviter").
 *
 *  2. onUserContactUpdated() : écoute l'event USER_CONTACT_UPDATED et met à jour
 *     automatiquement matchedUserId pour tous les contacts concernés.
 *     Appelé quand un utilisateur s'inscrit ou change son email/téléphone.
 *
 * ─── Normalisation ───────────────────────────────────────────────────────────
 *  Téléphones : normalisePhone() → E.164 (ex: '+33612345678')
 *  Emails     : toLowerCase()
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { normalizePhones } from '../../../utils';
import {
  USER_CONTACT_UPDATED,
  type UserContactUpdatedEvent,
} from '../../../events';
import type { Contact } from '../entities';
import type { SyncContactsDto } from '../dto';
import {
  CONTACTS_REPOSITORY,
  type ContactsRepository,
  type UpsertContactData,
} from '../repositories';
import { USERS_REPOSITORY, type UsersRepository } from '../../users/repositories';

export interface SyncContactsResult {
  /** Contacts déjà inscrits sur Humlinker */
  matched: Contact[];
  /** Contacts non inscrits — affichés avec un bouton "Inviter" */
  unmatched: Contact[];
}

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    @Inject(CONTACTS_REPOSITORY)
    private readonly contactsRepository: ContactsRepository,
    @Inject(USERS_REPOSITORY)
    private readonly usersRepository: UsersRepository,
  ) {}

  // ─── Sync contacts ────────────────────────────────────────────────────────

  /**
   * Synchronise les contacts téléphone d'un utilisateur.
   *
   * Étapes :
   * 1. Normalise les numéros (E.164) et emails (lowercase)
   * 2. Pour chaque contact, vérifie si un user Humlinker correspond
   *    (email, phoneNumber, previousEmails, previousPhoneNumbers)
   * 3. Upsert en masse en DB avec matchedUserId
   * 4. Retourne { matched[], unmatched[] } — matched en haut de liste
   */
  async syncContacts(
    ownerId: string,
    dto: SyncContactsDto,
  ): Promise<SyncContactsResult> {
    const toUpsert: UpsertContactData[] = [];

    for (const contact of dto.contacts) {
      // Normalisation
      const normalizedPhones = normalizePhones(
        contact.phoneNumbers ?? [],
        dto.countryCode,
      );
      const normalizedEmails = (contact.emails ?? []).map((e) =>
        e.toLowerCase().trim(),
      );

      // Matching : cherche un user Humlinker pour ce contact
      const matchedUserId = await this.findMatchingUser(
        normalizedPhones,
        normalizedEmails,
      );

      toUpsert.push({
        ownerId,
        name: contact.name,
        phoneNumbers: normalizedPhones,
        emails: normalizedEmails,
        matchedUserId,
      });
    }

    // Upsert en masse (transaction)
    const saved = await this.contactsRepository.upsertMany(toUpsert);

    return this.splitMatchedUnmatched(saved);
  }

  /**
   * Retourne les contacts d'un utilisateur depuis la DB
   * (sans refaire la sync — utile pour le rechargement d'écran).
   */
  async getContacts(ownerId: string): Promise<SyncContactsResult> {
    const contacts = await this.contactsRepository.findAllByOwner(ownerId);
    return this.splitMatchedUnmatched(contacts);
  }

  // ─── EventEmitter listener ────────────────────────────────────────────────

  /**
   * Appelé automatiquement quand un utilisateur s'inscrit ou change ses coordonnées.
   * Met à jour matchedUserId pour tous les contacts qui ont ces numéros/emails.
   */
  @OnEvent(USER_CONTACT_UPDATED)
  async onUserContactUpdated(event: UserContactUpdatedEvent): Promise<void> {
    try {
      // 1. Ajouter le match pour les contacts qui ont ces coordonnées
      const updated = await this.contactsRepository.updateMatchByPhoneOrEmail(
        event.userId,
        event.phones,
        event.emails,
      );

      if (updated > 0) {
        this.logger.log(
          `Contact sync: ${updated} contact(s) liés à l'utilisateur ${event.userId}`,
        );
      }

      // 2. Retirer les anciens matches qui ne correspondent plus
      //    (ex: l'user a changé de numéro — on dissocie les contacts qui avaient l'ancien)
      await this.contactsRepository.clearStaleMatches(
        event.userId,
        event.phones,
        event.emails,
      );
    } catch (err) {
      // On ne fait pas planter l'app si le sync de contacts échoue
      this.logger.error(
        `Erreur lors du sync automatique des contacts pour userId=${event.userId}`,
        err,
      );
    }
  }

  // ─── Utilitaires privés ───────────────────────────────────────────────────

  /**
   * Cherche un utilisateur Humlinker correspondant à ces coordonnées.
   * Vérifie email, phoneNumber, previousEmails, previousPhoneNumbers.
   * Retourne le userId si trouvé, null sinon.
   */
  private async findMatchingUser(
    phones: string[],
    emails: string[],
  ): Promise<string | null> {
    // Cherche par téléphone actuel ou ancien
    for (const phone of phones) {
      const user = await this.usersRepository.findByPhoneNumber(phone);
      if (user && !user.isPlaceholder) return user._id;

      // Vérifie dans les anciens numéros
      const byPrevious = await this.usersRepository.findByPreviousContact(phone);
      if (byPrevious && !byPrevious.isPlaceholder) return byPrevious._id;
    }

    // Cherche par email actuel ou ancien
    for (const email of emails) {
      const user = await this.usersRepository.findByEmail(email);
      if (user && !user.isPlaceholder) return user._id;

      const byPrevious = await this.usersRepository.findByPreviousContact(email);
      if (byPrevious && !byPrevious.isPlaceholder) return byPrevious._id;
    }

    return null;
  }

  private splitMatchedUnmatched(contacts: Contact[]): SyncContactsResult {
    const matched: Contact[] = [];
    const unmatched: Contact[] = [];

    for (const c of contacts) {
      if (c.matchedUserId) {
        matched.push(c);
      } else {
        unmatched.push(c);
      }
    }

    return { matched, unmatched };
  }
}
