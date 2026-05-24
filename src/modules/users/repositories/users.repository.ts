import type { User } from '../entities';

export interface UsersRepository {
  findById(id: string): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  create(user: User): Promise<User>;
  update(id: string, user: Partial<User>): Promise<User | null>;
}
