import type { User } from '../modules/users/entities';

/**
 * User sécurisé — sans passwordHash ni fcmToken.
 * passwordHash : ne jamais exposer les credentials
 * fcmToken     : token device Firebase, privé au user, inutile côté client
 */
export type SafeUser = Omit<User, 'passwordHash' | 'fcmToken'>;

/**
 * Retire passwordHash et fcmToken avant de retourner un user au frontend.
 */
export function sanitizeUser(user: User): SafeUser {
  const { passwordHash: _pw, fcmToken: _fcm, ...safeUser } = user;
  return safeUser;
}

/**
 * Applique sanitizeUser sur une liste de users.
 */
export function sanitizeUsers(users: User[]): SafeUser[] {
  return users.map(sanitizeUser);
}