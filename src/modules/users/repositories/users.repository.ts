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
  pin: string;
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
}

export interface UpdateUserData {
  role?: 'user' | 'admin';
  gender?: User['gender'];
  firstName?: string | null;
  lastName?: string | null;
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
  fcmToken?: string | null;
}

export interface UsersRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByPin(pin: string): Promise<User | null>;
  findByPhoneNumber(phoneNumber: string): Promise<User | null>;
  /** Recherche par email ou téléphone. Utilisé lors de la connexion. */
  findByEmailOrPhone(identifier: string): Promise<User | null>;
  create(data: CreateUserData): Promise<User>;
  update(id: string, data: UpdateUserData): Promise<User | null>;
  updateLastLoginAt(id: string, date: Date): Promise<User | null>;
}
