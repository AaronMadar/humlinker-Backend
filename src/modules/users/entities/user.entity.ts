export type UserGender = 'male' | 'female' | 'other';

export type UserAuthProvider = 'local' | 'google';

export type PlanTier = 'free' | 'pro';

export type UserPlaceholderSource = 'humlinker_invitation' | 'manual' | null;

export interface User {
  _id: string;
  role: 'user' | 'admin';
  gender: UserGender | null;
  firstName: string | null;
  lastName: string | null;
  /** PIN unique 8 caractères (style BBM). Généré auto, non modifiable. */
  pin: string;
  email: string | null;
  phoneNumber: string | null;
  language: string;
  passwordHash: string | null;
  authProviders: UserAuthProvider[];
  profilePicture: string | null;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  isPlaceholder: boolean;
  placeholderSource: UserPlaceholderSource;

  /** Token FCM pour les push notifications */
  fcmToken: string | null;

  /** Offre actuelle — voir src/modules/billing/plans.config.ts */
  plan: PlanTier;
  /** Fin de la période payée (null = pas d'expiration) */
  planExpiresAt: Date | null;

  /** Stripe — identifiants et état de l'abonnement */
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;

  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}
