/**
 * RedisService
 *
 * Wrapper autour du client ioredis.
 * Utilisé principalement par OtpService pour stocker :
 *  - otp:email:{email}       → code OTP envoyé par email (TTL 5 min)
 *  - otp:phone:{phone}       → code OTP envoyé par SMS (TTL 5 min)
 *  - verified:email:{email}  → flag "email vérifié" (TTL 15 min)
 *  - verified:phone:{phone}  → flag "téléphone vérifié" (TTL 15 min)
 *
 * Ce service est @Global() donc injectable partout sans réimporter le module.
 */
import { Inject, Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  /**
   * Stocke une valeur avec une durée d'expiration en secondes.
   * ex: set('otp:email:test@test.com', '123456', 300)
   */
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  /**
   * Récupère une valeur. Retourne null si la clé n'existe pas ou est expirée.
   */
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  /**
   * Supprime une clé (après vérification OTP réussie par exemple).
   */
  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  /**
   * Vérifie si une clé existe sans récupérer sa valeur.
   * Utile pour vérifier les flags "verified:email" ou "verified:phone".
   */
  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  /**
   * Incrémente un compteur et pose son TTL au premier incrément (fenêtre fixe).
   * Atomique (MULTI) → fiable même avec plusieurs instances du backend.
   * Retourne la nouvelle valeur et le TTL restant (secondes).
   */
  async incrWithTtl(
    key: string,
    ttlSeconds: number,
  ): Promise<{ count: number; ttl: number }> {
    return this.incrByWithTtl(key, 1, ttlSeconds);
  }

  /** Comme incrWithTtl, mais ajoute `amount` (ex : coût en micro-dollars). */
  async incrByWithTtl(
    key: string,
    amount: number,
    ttlSeconds: number,
  ): Promise<{ count: number; ttl: number }> {
    const results = await this.client.multi().incrby(key, amount).ttl(key).exec();
    const count = Number(results?.[0]?.[1] ?? 0);
    let ttl = Number(results?.[1]?.[1] ?? -1);
    // Clé neuve (ou sans expiration) → on pose la fenêtre
    if (ttl < 0) {
      await this.client.expire(key, ttlSeconds);
      ttl = ttlSeconds;
    }
    return { count, ttl };
  }

  /**
   * Pose une clé seulement si elle n'existe pas (verrou / cooldown).
   * Retourne true si la clé a été créée, false si elle existait déjà.
   */
  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  /** TTL restant d'une clé en secondes (0 si absente ou sans expiration). */
  async ttl(key: string): Promise<number> {
    const ttl = await this.client.ttl(key);
    return ttl > 0 ? ttl : 0;
  }

  // Ferme proprement la connexion Redis à la destruction du module NestJS
  onModuleDestroy() {
    this.client.disconnect();
    this.logger.log('Redis connection closed');
  }
}
