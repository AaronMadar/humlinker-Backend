export type UserGender = 'male' | 'female' | 'other';

export type UserAuthProvider = 'local' | 'google';

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

  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}
