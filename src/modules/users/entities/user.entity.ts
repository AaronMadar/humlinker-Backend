export type UserAuthProvider = 'local' | 'google';

export type UserPlaceholderSource = 'humlinker_invitation' | 'manual' | null;

export interface User {
  _id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string | null;
  phoneNumber: string | null;
  language: string;
  passwordHash: string;
  authProviders: UserAuthProvider[];
  profilePicture: string | null;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  isPlaceholder: boolean;
  placeholderSource: UserPlaceholderSource;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}
