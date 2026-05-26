import type { User } from '../modules/users/entities';

/**
 * User sécurisé sans passwordHash.
 */
export type SafeUser = Omit<User, 'passwordHash'>;

/**
 * Retire passwordHash avant de retourner un user au frontend.
 * On decompose user, en 2 , et on prend que safe user qui est la 2eme partie qui nous interesse sans password
 */
export function sanitizeUser(user: User): SafeUser {
  const { passwordHash: _passwordHash, ...safeUser } = user;

  return safeUser;
}

/**
 * Applique sanitizeUser sur une liste de users.
 */
export function sanitizeUsers(users: User[]): SafeUser[] {
  return users.map(sanitizeUser);
}