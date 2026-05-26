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
import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: { origin: '*' }, // À restreindre en production
  namespace: '/humlinker',
})
export class HumlinkerGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private readonly server: Server;

  private readonly logger = new Logger(HumlinkerGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  // ─── Connexion ────────────────────────────────────────────────────────────

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const token =
        (socket.handshake.auth?.token as string)?.replace('Bearer ', '') ?? '';

      const payload = this.jwtService.verify<{ userId: string }>(token);
      socket.data.userId = payload.userId;

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

  // ─── Émission ciblée ──────────────────────────────────────────────────────

  /**
   * Envoie un événement à un utilisateur spécifique (via sa room userId).
   * Si l'utilisateur n'est pas connecté, l'événement est silencieusement ignoré.
   */
  sendToUser(userId: string, event: string, data: unknown): void {
    this.server.to(`user:${userId}`).emit(event, data);
  }
}
