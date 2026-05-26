/**
 * WebhookService
 *
 * Traite les webhooks Twilio Conversations entrants.
 * Chaque humlinker non-app a son propre conversationSid Twilio,
 * ce qui permet de router précisément le message au bon humlinker mirror
 * même si le target a reçu plusieurs humlinkers de personnes différentes.
 *
 * ─── Flow ────────────────────────────────────────────────────────────────────
 *  1. Twilio POST /webhooks/twilio avec conversationSid + message du target
 *  2. On trouve le humlinker via twilioConversationSid
 *  3. On trouve le sender original à notifier
 *  4. Si messageBody = "SEND" → sendDraft() depuis le mirror
 *  5. Sinon → processIncomingTargetMessage() → IA + notification WebSocket/FCM
 *
 * ─── Commande SEND ───────────────────────────────────────────────────────────
 *  Si le target tape "SEND" (insensible à la casse), on déclenche sendDraft()
 *  depuis le mirror humlinker → le realMessage part au sender original.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  HUMLINKER_REPOSITORY,
  type HumlinkerRepository,
} from '../../humlinker/repositories';
import { USERS_REPOSITORY, type UsersRepository } from '../../users/repositories';
import { MessagesService } from '../messages.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @Inject(HUMLINKER_REPOSITORY)
    private readonly humlinkerRepository: HumlinkerRepository,
    @Inject(USERS_REPOSITORY)
    private readonly usersRepository: UsersRepository,
    private readonly messagesService: MessagesService,
  ) {}

  /**
   * Traite un message entrant Twilio Conversations.
   *
   * @param conversationSid  SID de la conversation Twilio (identifie le humlinker)
   * @param messageBody      Texte brut envoyé par le target
   * @param authorPhone      Numéro E.164 de l'expéditeur (le target)
   */
  async handleIncoming(
    conversationSid: string,
    messageBody: string,
    authorPhone: string,
  ): Promise<void> {
    // 1. Trouve le humlinker via conversationSid
    const humlinker = await this.humlinkerRepository.findByTwilioConversationSid(
      conversationSid,
    );

    if (!humlinker) {
      this.logger.warn(
        `Webhook Twilio : aucun humlinker trouvé pour conversationSid=${conversationSid}`,
      );
      return;
    }

    if (!humlinker.mirrorId) {
      this.logger.warn(`Humlinker ${humlinker._id} sans mirrorId.`);
      return;
    }

    // 2. Sender original à notifier
    const senderUser = await this.usersRepository.findById(humlinker.senderId);
    if (!senderUser) return;

    // Nom du target qui répond (affiché dans la notification)
    const targetUser = await this.usersRepository.findById(humlinker.targetId);
    const senderName = targetUser?.firstName
      ? `${targetUser.firstName}${targetUser.lastName ? ` ${targetUser.lastName}` : ''}`
      : humlinker.targetContactName;

    // 3. Commande SEND → envoie le draft du mirror au sender
    if (messageBody.trim().toUpperCase() === 'SEND') {
      try {
        await this.messagesService.sendDraft(humlinker.mirrorId, humlinker.targetId);
        this.logger.log(
          `SEND reçu de ${authorPhone} → draft miroir envoyé au sender ${humlinker.senderId}`,
        );
      } catch (err) {
        this.logger.error('Erreur sendDraft depuis webhook', err);
      }
      return;
    }

    // 4. Message normal → traitement IA + notification sender
    await this.messagesService.processIncomingTargetMessage(
      humlinker.mirrorId,
      messageBody,
      senderUser._id,
      senderUser.fcmToken ?? null,
      senderName,
    );
  }
}
