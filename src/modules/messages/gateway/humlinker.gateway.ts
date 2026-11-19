/**
 * HumlinkerGateway — WebSocket Gateway (Socket.io)
 *
 * Gère les connexions WebSocket des utilisateurs de l'app.
 * Chaque utilisateur rejoint une "room" à son userId dès la connexion,
 * ce qui permet de lui pousser des événements ciblés sans broadcast global.
 *
 * ─── Authentification ──────────────────────────────────────────────────────
 *  Le client envoie son JWT dans le handshake :
 *  { auth: { token: "Bearer <jwt>" } }
 *  Le gateway vérifie le token et stocke userId dans socket.data.
 *
 * ─── Événements émis (server → client) ────────────────────────────────────
 *  'new_message'      → nouveau realMessage reçu dans un humlinker
 *  'draft_updated'    → objectiveMessage du draft actif mis à jour
 *  'humlinker_blocked'→ humlinker bloqué par l'autre côté
 *  'session_revoked'  → session fermée (le socket est ensuite coupé)
 *
 * ─── Événements reçus (client → server) ───────────────────────────────────
 *  Aucun pour l'instant — toutes les actions passent par les routes HTTP REST.
 */
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import type { Server, Socket } from 'socket.io';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import {
  SESSIONS_REVOKED,
  SessionService,
  type SessionsRevokedEvent,
} from '../../auth/sessions/session.service';

@WebSocketGateway({
  // CORS géré par CorsIoAdapter (origines de FRONTEND_URL) — voir main.ts
  namespace: '/humlinker',
})
export class HumlinkerGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private readonly server: Server;

  private readonly logger = new Logger(HumlinkerGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly sessions: SessionService,
  ) {}

  // ─── Connexion ────────────────────────────────────────────────────────────

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const token =
        (socket.handshake.auth?.token as string)?.replace('Bearer ', '') ?? '';

      const payload = this.jwtService.verify<JwtPayload>(token);
      // Jeton invité : accès limité à UN humlinker par HTTP ; la room user:<id>
      // recevrait les événements de toutes ses conversations → refusé.
      if (payload.scope) throw new Error('guest token');
      // Session révoquée (déconnexion, tous les appareils, mot de passe changé)
      if (!(await this.sessions.isAccessPayloadValid(payload))) {
        throw new Error('revoked session');
      }
      socket.data.userId = payload.userId;
      socket.data.sid = payload.sid ?? null;

      // Chaque user rejoint sa room personnelle → ciblage précis des events
      await socket.join(`user:${payload.userId}`);
      this.logger.log(`WebSocket connecté : userId=${payload.userId}`);
    } catch {
      this.logger.warn('WebSocket rejeté — token invalide.');
      socket.emit('error', { message: 'Token invalide.' });
      socket.disconnect();
    }
  }

  handleDisconnect(socket: Socket): void {
    if (socket.data.userId) {
      this.logger.log(`WebSocket déconnecté : userId=${socket.data.userId}`);
    }
  }

  /**
   * Sessions révoquées → les sockets concernés sont coupés (le client se
   * reconnecte avec un jeton valide, ou pas du tout s'il est déconnecté).
   */
  @OnEvent(SESSIONS_REVOKED)
  async onSessionsRevoked(event: SessionsRevokedEvent): Promise<void> {
    if (!this.server) return;
    const sockets = await this.server.in(`user:${event.userId}`).fetchSockets();
    for (const s of sockets) {
      const sid = (s.data as { sid?: string | null }).sid ?? null;
      const concerned = event.onlySid
        ? sid === event.onlySid
        : !event.exceptSid || sid !== event.exceptSid;
      if (concerned) {
        s.emit('session_revoked', {});
        s.disconnect(true);
      }
    }
  }

  // ─── Émission ciblée ──────────────────────────────────────────────────────

  /**
   * Envoie un événement à un utilisateur spécifique (via sa room userId).
   * Si l'utilisateur n'est pas connecté, l'événement est silencieusement ignoré.
   */
  sendToUser(userId: string, event: string, data: unknown): void {
    this.server.to(`user:${userId}`).emit(event, data);
  }
}
