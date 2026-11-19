/**
 * SessionService — sessions de connexion (jeton d'accès court + jeton de rafraîchissement).
 *
 * ─── Jetons ────────────────────────────────────────────────────────────────
 *  - Jeton d'accès : JWT court (15 min par défaut)
 *      { userId, role, tv: <User.tokenVersion>, sid: <id de session> }
 *  - Jeton de rafraîchissement : `<sid>.<secret aléatoire 256 bits>`, opaque.
 *    Seul le SHA-256 du secret est stocké (Redis). Durée glissante de 30 jours.
 *
 * ─── Rotation et détection de réutilisation ───────────────────────────────
 *  Chaque POST /auth/refresh consomme le jeton et en rend un nouveau (même sid =
 *  même « famille »). Si un ancien jeton déjà consommé est présenté, c'est qu'il a
 *  été copié : toute la famille est révoquée (le voleur ET l'appareil légitime
 *  sont déconnectés). Exception : le jeton précédent présenté dans les
 *  REFRESH_RACE_GRACE_SEC secondes qui suivent une rotation (deux onglets qui
 *  rafraîchissent en même temps) → refus sans révocation, code `refresh_race` ;
 *  le front relit alors le nouveau jeton déposé par l'autre onglet.
 *
 * ─── Révocation ────────────────────────────────────────────────────────────
 *  - revokeSession(sid)      : déconnexion de l'appareil courant ;
 *  - revokeAll(userId)       : toutes les familles supprimées + User.tokenVersion
 *    incrémenté → tous les jetons d'accès déjà émis sont refusés immédiatement
 *    (y compris les anciens jetons sans sid). Option exceptSid : garder la
 *    session courante (changement de mot de passe).
 *  Chaque jeton d'accès avec sid est aussi refusé dès que sa famille n'existe
 *  plus (jwt.strategy.ts, gateway WebSocket).
 *
 * Les jetons invités (scope 'guest', lien « Répondre » des emails) ne passent
 * PAS par ici : ils restent des JWT autonomes de 30 jours (guest-token.ts).
 */
import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { APP_CONFIG } from '@/config';
import configuration from '@/config/configuration';
import { PrismaService } from '@/database';
import { RedisService } from '@/redis/redis.service';
import type { JwtPayload } from '../interfaces/jwt-payload.interface';

/** Événement émis après révocation de sessions (le gateway WebSocket déconnecte les sockets) */
export const SESSIONS_REVOKED = 'auth.sessions.revoked';
export interface SessionsRevokedEvent {
  userId: string;
  /** Session conservée (changement de mot de passe) — null = toutes */
  exceptSid: string | null;
  /** Si présent : seule cette session est concernée (déconnexion d'un appareil) */
  onlySid?: string;
}

export const REFRESH_RACE_GRACE_SEC = 30;
const LOCK_TTL_SEC = 10;

export interface SessionUser {
  _id: string;
  role: 'user' | 'admin';
  tokenVersion?: number;
}

export interface TokenPair {
  token: string;
  refreshToken: string;
}

interface FamilyRecord {
  userId: string;
  /** SHA-256 (hex) du secret courant */
  hash: string;
  /** SHA-256 du secret précédent (consommé) — pour distinguer course / vol */
  prevHash: string | null;
  /** Date de la dernière rotation (ms) */
  rotatedAt: number;
  createdAt: number;
}

const familyKey = (sid: string) => `auth:rt:${sid}`;
const userSessionsKey = (userId: string) => `auth:rt:user:${userId}`;
const lockKey = (sid: string) => `auth:rt:lock:${sid}`;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sameHash(a: string, b: string | null): boolean {
  if (!b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function refreshError(code: string, message: string): UnauthorizedException {
  return new UnauthorizedException({ code, message });
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    @Inject(APP_CONFIG)
    private readonly config: ReturnType<typeof configuration>,
  ) {}

  private get refreshTtlSec(): number {
    return Math.max(1, this.config.jwt.refreshTtlDays) * 24 * 60 * 60;
  }

  // ─── Création ─────────────────────────────────────────────────────────────

  /** Ouvre une nouvelle session (connexion, inscription, Google). */
  async createSession(user: SessionUser): Promise<TokenPair> {
    const sid = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const now = Date.now();
    const record: FamilyRecord = {
      userId: user._id,
      hash: sha256(secret),
      prevHash: null,
      rotatedAt: now,
      createdAt: now,
    };
    await this.redis.set(familyKey(sid), JSON.stringify(record), this.refreshTtlSec);
    await this.redis.sadd(userSessionsKey(user._id), sid, this.refreshTtlSec);
    return { token: this.signAccessToken(user, sid), refreshToken: `${sid}.${secret}` };
  }

  /** Jeton d'accès court pour une session existante. */
  signAccessToken(user: SessionUser, sid: string): string {
    const payload: JwtPayload = {
      userId: user._id,
      role: user.role,
      tv: user.tokenVersion ?? 0,
      sid,
    };
    return this.jwtService.sign(payload, {
      expiresIn: this.config.jwt.accessExpiresIn as `${number}m`,
    });
  }

  // ─── Rafraîchissement (rotation) ──────────────────────────────────────────

  async refresh(refreshToken: string): Promise<TokenPair> {
    const parsed = this.parse(refreshToken);
    if (!parsed) throw refreshError('refresh_invalid', 'Session invalide.');
    const { sid, secret } = parsed;

    // Une seule rotation à la fois par session (plusieurs instances / requêtes)
    if (!(await this.redis.setIfAbsent(lockKey(sid), '1', LOCK_TTL_SEC))) {
      throw refreshError('refresh_race', 'Rafraîchissement déjà en cours.');
    }
    try {
      const record = await this.readFamily(sid);
      if (!record) throw refreshError('refresh_invalid', 'Session expirée ou révoquée.');

      const presented = sha256(secret);
      if (!sameHash(presented, record.hash)) {
        const recentRace =
          sameHash(presented, record.prevHash) &&
          Date.now() - record.rotatedAt < REFRESH_RACE_GRACE_SEC * 1000;
        if (recentRace) {
          throw refreshError('refresh_race', 'Session déjà rafraîchie.');
        }
        // Jeton déjà consommé ou forgé : vol probable → toute la famille révoquée
        await this.revokeSession(sid, record.userId);
        this.logger.warn(
          `Réutilisation d'un jeton de rafraîchissement — session ${sid} révoquée (user ${record.userId})`,
        );
        throw refreshError('refresh_reused', 'Session révoquée par sécurité.');
      }

      const user = await this.prisma.user.findFirst({
        where: { id: record.userId, deletedAt: null },
        select: { id: true, role: true, tokenVersion: true },
      });
      if (!user) {
        await this.revokeSession(sid, record.userId);
        throw refreshError('refresh_invalid', 'Compte introuvable.');
      }

      const nextSecret = randomBytes(32).toString('base64url');
      const next: FamilyRecord = {
        ...record,
        hash: sha256(nextSecret),
        prevHash: record.hash,
        rotatedAt: Date.now(),
      };
      await this.redis.set(familyKey(sid), JSON.stringify(next), this.refreshTtlSec);
      await this.redis.sadd(userSessionsKey(user.id), sid, this.refreshTtlSec);

      return {
        token: this.signAccessToken(
          { _id: user.id, role: user.role, tokenVersion: user.tokenVersion },
          sid,
        ),
        refreshToken: `${sid}.${nextSecret}`,
      };
    } finally {
      await this.redis.del(lockKey(sid));
    }
  }

  // ─── Révocation ───────────────────────────────────────────────────────────

  /**
   * Déconnexion de l'appareil courant à partir de son jeton de rafraîchissement.
   * Idempotent : un jeton inconnu ou déjà révoqué ne lève pas d'erreur.
   */
  async logout(refreshToken: string): Promise<void> {
    const parsed = this.parse(refreshToken);
    if (!parsed) return;
    const record = await this.readFamily(parsed.sid);
    if (!record) return;
    const presented = sha256(parsed.secret);
    // Le jeton courant ou le précédent prouvent la possession de la session
    if (sameHash(presented, record.hash) || sameHash(presented, record.prevHash)) {
      await this.revokeSession(parsed.sid, record.userId);
      this.emitRevoked(record.userId, null, parsed.sid);
    }
  }

  async revokeSession(sid: string, userId?: string): Promise<void> {
    const owner = userId ?? (await this.readFamily(sid))?.userId;
    await this.redis.del(familyKey(sid));
    if (owner) await this.redis.srem(userSessionsKey(owner), sid);
  }

  /**
   * Révoque toutes les sessions de l'utilisateur (sauf exceptSid) et invalide
   * tous les jetons d'accès déjà émis (tokenVersion + 1).
   * Retourne la nouvelle version (pour ré-émettre le jeton de la session gardée).
   */
  async revokeAll(
    userId: string,
    options: { exceptSid?: string | null } = {},
  ): Promise<number> {
    const exceptSid = options.exceptSid ?? null;
    const sids = await this.redis.smembers(userSessionsKey(userId));
    for (const sid of sids) {
      if (sid === exceptSid) continue;
      await this.revokeSession(sid, userId);
    }
    const { tokenVersion } = await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
      select: { tokenVersion: true },
    });
    this.emitRevoked(userId, exceptSid);
    return tokenVersion;
  }

  // ─── Vérification des jetons d'accès ──────────────────────────────────────

  /** La famille (session) existe-t-elle encore ? */
  async isSessionActive(sid: string): Promise<boolean> {
    return this.redis.exists(familyKey(sid));
  }

  /**
   * Un jeton d'accès de session est-il encore valable ? (version + session)
   * `currentTokenVersion` évite une requête quand l'appelant a déjà l'utilisateur.
   * Les jetons sans sid (émis avant les sessions) restent valables jusqu'à leur
   * expiration, tant que la version n'a pas changé.
   */
  async isAccessPayloadValid(
    payload: JwtPayload,
    currentTokenVersion?: number,
  ): Promise<boolean> {
    let version = currentTokenVersion;
    if (version === undefined) {
      const user = await this.prisma.user.findFirst({
        where: { id: payload.userId, deletedAt: null },
        select: { tokenVersion: true },
      });
      if (!user) return false;
      version = user.tokenVersion;
    }
    if ((payload.tv ?? 0) !== version) return false;
    if (payload.sid && !(await this.isSessionActive(payload.sid))) return false;
    return true;
  }

  // ─── Utilitaires ──────────────────────────────────────────────────────────

  private emitRevoked(userId: string, exceptSid: string | null, onlySid?: string): void {
    const event: SessionsRevokedEvent = { userId, exceptSid, ...(onlySid && { onlySid }) };
    this.events.emit(SESSIONS_REVOKED, event);
  }

  private parse(token: string): { sid: string; secret: string } | null {
    if (typeof token !== 'string' || token.length > 200) return null;
    const dot = token.indexOf('.');
    if (dot <= 0 || dot === token.length - 1) return null;
    return { sid: token.slice(0, dot), secret: token.slice(dot + 1) };
  }

  private async readFamily(sid: string): Promise<FamilyRecord | null> {
    const raw = await this.redis.get(familyKey(sid));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as FamilyRecord;
    } catch {
      return null;
    }
  }
}
