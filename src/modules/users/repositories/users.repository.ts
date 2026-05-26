import type {
  User,
  UserAuthProvider,
  UserPlaceholderSource,
} from '../entities';

export const USERS_REPOSITORY = Symbol('USERS_REPOSITORY');

export interface CreateUserData {
  role?: 'user' | 'admin';
  gender?: User['gender'];
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
  language: string;
  passwordHash?: string | null;
  authProviders: UserAuthProvider[];
  profilePicture?: string | null;
  isEmailVerified?: boolean;
  isPhoneVerified?: boolean;
  isPlaceholder?: boolean;
  placeholderSource?: UserPlaceholderSource;
  previousEmails?: string[];
  previousPhoneNumbers?: string[];
}

export interface UpdateUserData {
  role?: 'user' | 'admin';
  gender?: User['gender'];
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
  language?: string;
  passwordHash?: string | null;
  authProviders?: UserAuthProvider[];
  profilePicture?: string | null;
  isEmailVerified?: boolean;
  isPhoneVerified?: boolean;
  isPlaceholder?: boolean;
  placeholderSource?: UserPlaceholderSource;
  lastLoginAt?: Date | null;
  previousEmails?: string[];
  previousPhoneNumbers?: string[];
  fcmToken?: string | null;
}

export interface UsersRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  findByPhoneNumber(phoneNumber: string): Promise<User | null>;
  /**
   * Recherche un user par email, username ou numéro de téléphone (actuel).
   * Utilisé lors de la connexion.
   */
  findByEmailOrUsernameOrPhone(identifier: string): Promise<User | null>;
  /**
   * Recherche un user dont l'email OU le téléphone figure dans
   * previousEmails ou previousPhoneNumbers.
   * Utilisé pour la synchronisation des contacts téléphone.
   */
  findByPreviousContact(contact: string): Promise<User | null>;
  create(data: CreateUserData): Promise<User>;
  update(id: string, data: UpdateUserData): Promise<User | null>;
  updateLastLoginAt(id: string, date: Date): Promise<User | null>;
  /**
   * Recherche des utilisateurs inscrits (non-placeholder) par username, prénom,
   * nom, email ou téléphone. Exclut l'utilisateur appelant.
   */
  searchUsers(query: string, excludeUserId: string, limit: number): Promise<User[]>;
}
