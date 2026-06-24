/**
 * NotificationsService
 *
 * Orchestre les notifications temps réel et push.
 *
 * ─── Deux canaux ───────────────────────────────────────────────────────────
 *  1. WebSocket (Socket.io via HumlinkerGateway)
 *     → L'utilisateur est actif sur l'app → message poussé instantanément
 *
 *  2. FCM (Firebase Cloud Messaging via firebase-admin)
 *     → L'app est en arrière-plan ou fermée → push notification mobile/desktop
 *     → Le token FCM est stocké sur l'utilisateur (fcmToken), mis à jour à chaque login
 *
 * ─── Événements WebSocket émis ────────────────────────────────────────────
 *  'new_message'   → nouveau message reçu dans un humlinker
 *  'draft_updated' → le draft actif a été mis à jour
 *  'humlinker_blocked' → humlinker bloqué par l'autre côté
 */
import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { HumlinkerGateway } from '../messages/gateway/humlinker.gateway';

export interface NewMessageNotification {
  humhlinkerId: string;
  senderName: string;
  messagePreview: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private firebaseInitialized = false;

  constructor(private readonly gateway: HumlinkerGateway) {}

  /**
   * Initialise Firebase Admin SDK (appelé au démarrage de l'app).
   * Utilise les variables d'environnement FIREBASE_*.
   */
  initFirebase(config: {
    projectId: string;
    clientEmail: string;
    privateKey: string;
  }): void {
    if (this.firebaseInitialized || admin.apps.length > 0) return;

    if (!config.projectId || !config.clientEmail || !config.privateKey) {
      this.logger.warn(
        'Firebase non configuré — push notifications désactivées. Renseignez FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.',
      );
      return;
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: config.projectId,
        clientEmail: config.clientEmail,
        privateKey: config.privateKey,
      }),
    });
    this.firebaseInitialized = true;
    this.logger.log('Firebase Admin SDK initialisé.');
  }

  /**
   * Notifie un utilisateur d'un nouveau message reçu.
   *
   * 1. Pousse via WebSocket si l'utilisateur est connecté (in-app)
   * 2. Envoie une push FCM si l'utilisateur a un fcmToken (app fermée/background)
   */
  async notifyNewMessage(
    targetUserId: string,
    fcmToken: string | null,
    notification: NewMessageNotification,
  ): Promise<void> {
    // 1. WebSocket — temps réel si l'app est ouverte
    this.gateway.sendToUser(targetUserId, 'new_message', {
      humhlinkerId: notification.humhlinkerId,
      senderName: notification.senderName,
      preview: notification.messagePreview,
    });

    // 2. FCM — push si app fermée / background
    if (fcmToken && this.firebaseInitialized) {
      await this.sendFcmPush(fcmToken, {
        title: notification.senderName,
        body: notification.messagePreview,
        data: { humhlinkerId: notification.humhlinkerId, type: 'new_message' },
      });
    }
  }

  /**
   * Notifie le destinataire qu'il a reçu une nouvelle invitation (humlinker pending).
   * Le payload contient l'objet humlinker complet côté destinataire (record miroir).
   */
  notifyInvitationReceived(targetUserId: string, humlinker: unknown): void {
    this.gateway.sendToUser(targetUserId, 'invitation_received', { humlinker });
  }

  /**
   * Notifie un utilisateur que le statut de l'un de ses humlinkers a changé.
   * Utilisé pour : accept (→ active), decline/cancel (→ archived).
   */
  notifyHumlinkerStatusChanged(userId: string, humhlinkerId: string, status: string): void {
    this.gateway.sendToUser(userId, 'humlinker_status_changed', { humhlinkerId, status });
  }

  /**
   * Notifie un utilisateur que son draft a été mis à jour par l'IA.
   * Uniquement via WebSocket (pas de FCM pour les mises à jour de draft).
   */
  notifyDraftUpdated(
    userId: string,
    humhlinkerId: string,
    objectiveMessage: string,
  ): void {
    this.gateway.sendToUser(userId, 'draft_updated', {
      humhlinkerId,
      objectiveMessage,
    });
  }


  private async sendFcmPush(
    token: string,
    payload: { title: string; body: string; data?: Record<string, string> },
  ): Promise<void> {
    try {
      await admin.messaging().send({
        token,
        notification: { title: payload.title, body: payload.body },
        data: payload.data,
        android: { priority: 'high' },
        apns: { payload: { aps: { sound: 'default' } } },
      });
    } catch (err) {
      this.logger.error('Échec envoi FCM push', err);
    }
  }
}
