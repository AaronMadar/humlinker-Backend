/**
 * RateLimitGuard — limitation de débit globale, stockée dans Redis.
 *
 *  1. Limite globale par IP sur toutes les routes (anti-bot / anti-DoS applicatif).
 *  2. Limites spécifiques par route via @RateLimit(...) (OTP, login, IA, envoi…).
 *
 * Redis → les compteurs sont partagés entre toutes les instances du backend.
 * En cas de dépassement : 429 Too Many Requests + en-tête Retry-After.
 * Si Redis est indisponible, la requête passe (fail-open) et l'erreur est loguée,
 * pour ne pas couper toute l'application.
 */
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { RedisService } from '../../redis/redis.service';
import {
  MINUTE,
  RATE_LIMIT_KEY,
  SKIP_RATE_LIMIT_KEY,
  type RateLimitRule,
} from './rate-limit.decorator';

const GLOBAL_RULE: RateLimitRule = {
  name: 'global',
  by: 'ip',
  limit: parseInt(process.env.RATE_LIMIT_GLOBAL_PER_MINUTE ?? '300', 10),
  windowSec: MINUTE,
};

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const targets = [context.getHandler(), context.getClass()];
    if (
      this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, targets)
    ) {
      return true;
    }

    const routeRules =
      this.reflector.getAllAndOverride<RateLimitRule[]>(
        RATE_LIMIT_KEY,
        targets,
      ) ?? [];

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: { userId?: string } }>();
    const res = context.switchToHttp().getResponse<Response>();
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const userId = req.user?.userId;
    const route = `${context.getClass().name}.${context.getHandler().name}`;

    for (const rule of [GLOBAL_RULE, ...routeRules]) {
      const subject = rule.by === 'user' && userId ? `u:${userId}` : `ip:${ip}`;
      const scope = rule.name === 'global' ? 'global' : `${route}:${rule.name}`;
      const key = `rl:${scope}:${subject}`;

      let count: number;
      let ttl: number;
      try {
        ({ count, ttl } = await this.redis.incrWithTtl(key, rule.windowSec));
      } catch (err) {
        this.logger.error(
          `Rate limit indisponible (Redis) pour ${key}`,
          err as Error,
        );
        return true;
      }

      if (count > rule.limit) {
        res.setHeader('Retry-After', String(ttl));
        this.logger.warn(
          `Rate limit dépassé : ${key} (${count}/${rule.limit})`,
        );
        throw new HttpException(
          `Trop de requêtes. Réessayez dans ${formatDelay(ttl)}.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    return true;
  }
}

function formatDelay(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.ceil(minutes / 60)} h`;
}
