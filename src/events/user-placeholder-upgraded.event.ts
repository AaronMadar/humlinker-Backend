/**
 * UserPlaceholderUpgradedEvent
 *
 * Emis quand un utilisateur placeholder finalise son inscription.
 * Permet a HumlinkerService de :
 *  - Basculer tous ses humlinkers entrants vers le canal 'app'
 *  - Mettre a jour les snapshots sender/target sur tous les humlinkers lies
 *    avec les vraies donnees du compte (notamment sa vraie langue qui prend
 *    le dessus sur la langue estimee par le sender)
 */
export const USER_PLACEHOLDER_UPGRADED = 'user.placeholder_upgraded';

export class UserPlaceholderUpgradedEvent {
  constructor(
    /** ID du user qui vient de s'inscrire (ex-placeholder) */
    public readonly userId: string,
    public readonly firstName: string | null,
    public readonly lastName: string | null,
    public readonly email: string | null,
    public readonly phone: string | null,
    /** Vraie langue du compte - prend le dessus sur la langue estimee par le sender */
    public readonly language: string,
    public readonly gender: 'male' | 'female' | 'other' | null,
    public readonly profilePicture: string | null,
  ) {}
}
