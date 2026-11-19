export interface JwtPayload {
  userId: string;
  role?: 'user' | 'admin';
  /**
   * 'guest' = jeton invité envoyé par email à un destinataire sans compte
   * (placeholder) : il ne donne accès qu'à SON humlinker miroir.
   */
  scope?: 'guest';
  /** Humlinker miroir accessible avec un jeton invité */
  humlinkerId?: string;
  /** Version des sessions de l'utilisateur au moment de l'émission (User.tokenVersion) */
  tv?: number;
  /** Identifiant de session (famille de jetons de rafraîchissement) */
  sid?: string;
}

export interface AuthenticatedUser {
  userId: string;
  role: 'user' | 'admin';
  /** Présent uniquement pour un jeton invité (voir GuestScopeGuard) */
  scope?: 'guest';
  humlinkerId?: string;
  /** Session courante (absent pour les jetons invités et les anciens jetons) */
  sid?: string;
}
