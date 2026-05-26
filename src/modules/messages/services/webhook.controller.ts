/**
 * WebhookController
 *
 * Reçoit les webhooks entrants de Twilio Conversations.
 * Route publique (@Public) — Twilio n'envoie pas de JWT.
 *
 * ─── Sécurité ─────────────────────────────────────────────────────────────
 *  Twilio signe chaque requête avec un header X-Twilio-Signature.
 *  On valide cette signature pour s'assurer que la requête vient bien de Twilio
 *  et pas d'un acteur malveillant qui ferait des faux webhooks.
 *
 * ─── Route ────────────────────────────────────────────────────────────────
 *  POST /api/v1/webhooks/twilio
 *
 * ─── Body Twilio Conversations ────────────────────────────────────────────
 *  ConversationSid : SID unique de la conversation (identifie le humlinker)
 *  Body            : texte brut du message envoyé par le target
 *  Author          : numéro E.164 ou identité de l'auteur
 */
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Logger,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import * as twilio from 'twilio';
import { Public } from '../../../decorators';
import { WebhookService } from './webhook.service';

@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
  private readonly twilioAuthToken = process.env.TWILIO_AUTH_TOKEN ?? '';

  constructor(private readonly webhookService: WebhookService) {}

  /**
   * Point d'entrée des messages Twilio Conversations entrants.
   * Twilio poste ici quand le target répond par SMS/WhatsApp.
   */
  @Public()
  @Post('twilio')
  async handleTwilioWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-twilio-signature') twilioSignature: string,
    @Body() body: Record<string, string>,
  ): Promise<{ status: string }> {
    // Validation de la signature Twilio
    const url = `${process.env.APP_URL}/api/v1/webhooks/twilio`;
    const isValid = twilio.validateRequest(
      this.twilioAuthToken,
      twilioSignature ?? '',
      url,
      body,
    );

    if (!isValid && process.env.NODE_ENV === 'production') {
      this.logger.warn('Webhook Twilio rejeté : signature invalide.');
      throw new BadRequestException('Signature Twilio invalide.');
    }

    const conversationSid = body['ConversationSid'];
    const messageBody = body['Body'] ?? '';
    const author = body['Author'] ?? '';

    if (!conversationSid) {
      this.logger.warn('Webhook Twilio : ConversationSid manquant.');
      return { status: 'ignored' };
    }

    // Traitement asynchrone — on répond immédiatement à Twilio (timeout 5s)
    this.webhookService
      .handleIncoming(conversationSid, messageBody, author)
      .catch((err) =>
        this.logger.error('Erreur traitement webhook Twilio', err),
      );

    return { status: 'ok' };
  }
}
