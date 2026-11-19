/**
 * Faux RedisService en mémoire — pour les tests unitaires uniquement.
 * Reproduit le comportement (valeurs, TTL) sans serveur Redis.
 */
import type { RedisService } from './redis.service';

export class FakeRedisService implements Pick<
  RedisService,
  | 'set'
  | 'get'
  | 'del'
  | 'exists'
  | 'incrWithTtl'
  | 'incrByWithTtl'
  | 'setIfAbsent'
  | 'ttl'
  | 'sadd'
  | 'srem'
  | 'smembers'
> {
  private store = new Map<
    string,
    { value: string; expiresAt: number | null }
  >();
  public now = 0; // horloge contrôlable (secondes)

  private alive(key: string) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  advance(seconds: number) {
    this.now += seconds;
  }

  async set(key: string, value: string, ttlSeconds: number) {
    this.store.set(key, { value, expiresAt: this.now + ttlSeconds });
  }

  async get(key: string) {
    return this.alive(key)?.value ?? null;
  }

  async del(key: string) {
    this.store.delete(key);
  }

  async exists(key: string) {
    return this.alive(key) !== null;
  }

  async incrWithTtl(key: string, ttlSeconds: number) {
    return this.incrByWithTtl(key, 1, ttlSeconds);
  }

  async incrByWithTtl(key: string, amount: number, ttlSeconds: number) {
    const entry = this.alive(key);
    if (!entry) {
      this.store.set(key, {
        value: String(amount),
        expiresAt: this.now + ttlSeconds,
      });
      return { count: amount, ttl: ttlSeconds };
    }
    entry.value = String(Number(entry.value) + amount);
    return {
      count: Number(entry.value),
      ttl: (entry.expiresAt ?? this.now) - this.now,
    };
  }

  async setIfAbsent(key: string, value: string, ttlSeconds: number) {
    if (this.alive(key)) return false;
    await this.set(key, value, ttlSeconds);
    return true;
  }

  async ttl(key: string) {
    const entry = this.alive(key);
    return entry?.expiresAt ? entry.expiresAt - this.now : 0;
  }

  // Ensembles : stockés sérialisés (JSON) dans la même table
  async sadd(key: string, member: string, ttlSeconds: number) {
    const members = new Set(await this.smembers(key));
    members.add(member);
    this.store.set(key, {
      value: JSON.stringify([...members]),
      expiresAt: this.now + ttlSeconds,
    });
  }

  async srem(key: string, member: string) {
    const entry = this.alive(key);
    if (!entry) return;
    const members = (JSON.parse(entry.value) as string[]).filter((m) => m !== member);
    entry.value = JSON.stringify(members);
  }

  async smembers(key: string) {
    const entry = this.alive(key);
    return entry ? (JSON.parse(entry.value) as string[]) : [];
  }
}
