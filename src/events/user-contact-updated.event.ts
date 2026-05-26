/**
 * UserContactUpdatedEvent
 *
 * Émis par UsersService chaque fois qu'un utilisateur modifie son email
 * ou son numéro de téléphone, ou quand il s'inscrit pour la première fois.
 *
 * ContactsService écoute cet événement pour mettre à jour automatiquement
 * le champ matchedUserId dans la table contacts.
 *
 * ─── Flux ────────────────────────────────────────────────────────────────────
 *  UsersService.updateEmail()   → emit(USER_CONTACT_UPDATED, event)
 *  UsersService.updatePhone()   → emit(USER_CONTACT_UPDATED, event)
 *  AuthService.register()       → emit(USER_CONTACT_UPDATED, event)
 *  AuthService.completeGoogleProfile() → emit(USER_CONTACT_UPDATED, event)
 *    ↓
 *  ContactsService.onUserContactUpdated()
 *    → updateMatchByPhoneOrEmail(userId, newPhones, newEmails)
 *    → clearStaleMatches(userId, currentPhones, currentEmails)
 */

export const USER_CONTACT_UPDATED = 'user.contact_updated';

export class UserContactUpdatedEvent {
  constructor(
    /** ID de l'utilisateur concerné */
    public readonly userId: string,

    /** Nouveaux numéros E.164 de l'utilisateur (tableau) */
    public readonly phones: string[],

    /** Nouveaux emails (lowercase) de l'utilisateur (tableau) */
    public readonly emails: string[],
  ) {}
}
