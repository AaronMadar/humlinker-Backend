export type UserGender = 'male' | 'female' | 'other';

export type UserAuthProvider = 'local' | 'google';

export type UserPlaceholderSource = 'humlinker_invitation' | 'manual' | null;

export interface User {
  _id: string;
  role: 'user' | 'admin';
  gender: UserGender | null;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  email: string | null;
  phoneNumber: string | null;
  language: string; // jamais null — même pour un placeholder on prend la langue du créateur du humlinker
  passwordHash: string | null;
  authProviders: UserAuthProvider[];
  profilePicture: string | null;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  isPlaceholder: boolean;
  placeholderSource: UserPlaceholderSource;

  // Historique des anciens emails et téléphones.
  // Utilisé pour la synchro des contacts téléphone :
  // un contact qui a l'ancien numéro/email d'un utilisateur sera quand même retrouvé.
  previousEmails: string[];
  previousPhoneNumbers: string[];

  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}
