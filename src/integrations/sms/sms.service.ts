/**
 * SmsService
 *
 * Responsable de l'envoi des SMS et de la gestion des Twilio Conversations.
 *
 * ─── Usages ───────────────────────────────────────────────────────────────────
 *  sendOtp()                       → SMS OTP lors de la vérification du numéro
 *  sendMessage()                   → SMS simple (invitation Humlinker, fallback)
 *  createConversationForHumlinker()→ Crée une Twilio Conversation dédiée à un
 *                                    humlinker SMS/WhatsApp et y ajoute le target
 *                                    comme participant. Retourne le conversationSid
 *                                    qui sera stocké sur le humlinker.
 *  sendConversationMessage()       → Envoie un message dans une Conversation
 *                                    existante (realMessage vers le target).
 *
 * ─── Pourquoi Twilio Conversations ? ─────────────────────────────────────────
 *  Un même target peut avoir reçu des humlinkers de plusieurs senders via SMS.
 *  Sans Conversations, quand il répond, Twilio ne peut pas router la réponse
 *  au bon humlinker. Chaque Conversation a un SID unique → webhook identifie
 *  précisément le humlinker concerné via twilioConversationSid.
 *
 * ─── Config requise ──────────────────────────────────────────────────────────
 *  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
 *  TWILIO_PHONE_NUMBER   → numéro SMS E.164
 *  TWILIO_WHATSAPP_NUMBER→ numéro WhatsApp E.164 (sans "whatsapp:" prefix)
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import twilio from 'twilio';
import { APP_CONFIG } from '../../config';
import configuration from '../../config/configuration';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly client: twilio.Twilio;

  constructor(
    @Inject(APP_CONFIG)
    private readonly config: ReturnType<typeof configuration>,
  ) {
    this.client = twilio(config.twilio.accountSid, config.twilio.authToken);
  }

  // ─── OTP ──────────────────────────────────────────────────────────────────

  /**
   * Envoie un code OTP par SMS au numéro fourni.
   */
  async sendOtp(phoneNumber: string, code: string): Promise<void> {
    try {
      await this.client.messages.create({
        body: `Votre code de vérification Humlinker est : ${code}\nExpire dans 5 minutes.`,
        from: this.config.twilio.phoneNumber,
        to: phoneNumber,
      });
      this.logger.log(`OTP SMS sent to ${phoneNumber}`);
    } catch (error) {
      this.logger.error(`Failed to send OTP SMS to ${phoneNumber}`, error);
      throw error;
    }
  }

  // ─── SMS simple ───────────────────────────────────────────────────────────

  /**
   * Envoie un SMS simple (invitation, fallback).
   * À utiliser uniquement si aucune Conversation n'est établie.
   */
  async sendMessage(phoneNumber: string, message: string): Promise<void> {
    try {
      await this.client.messages.create({
        body: message,
        from: this.config.twilio.phoneNumber,
        to: phoneNumber,
      });
      this.logger.log(`SMS sent to ${phoneNumber}`);
    } catch (error) {
      this.logger.error(`Failed to send SMS to ${phoneNumber}`, error);
      throw error;
    }
  }

  // ─── Twilio Conversations ─────────────────────────────────────────────────

  /**
   * Crée une Twilio Conversation dédiée à un humlinker SMS/WhatsApp.
   *
   * Étapes :
   *  1. Crée la Conversation (thread Twilio identifiable par SID)
   *  2. Ajoute le target comme participant SMS ou WhatsApp
   *     → messagingBinding.address    : numéro du target
   *     → messagingBinding.proxyAddress : numéro Twilio (proxy entre les deux)
   *  3. Retourne le conversationSid à stocker sur le humlinker
   *
   * @param targetPhone  Numéro E.164 du target (ex: +33612345678)
   * @param channel      'sms' | 'whatsapp'
   * @param friendlyName Label lisible dans la console Twilio (humhlinkerId)
   */
  async createConversationForHumlinker(
    targetPhone: string,
    channel: 'sms' | 'whatsapp',
    friendlyName: string,
  ): Promise<string> {
    // 1. Crée la Conversation
    const conversation = await this.client.conversations.v1.conversations.create({
      friendlyName,
    });

    const conversationSid = conversation.sid;
    this.logger.log(`Conversation créée : ${conversationSid} (${friendlyName})`);

    try {
      // 2. Ajoute le target comme participant
      if (channel === 'whatsapp') {
        await this.client.conversations.v1
          .conversations(conversationSid)
          .participants.create({
            'messagingBinding.address': `whatsapp:${targetPhone}`,
            'messagingBinding.proxyAddress': `whatsapp:${this.config.twilio.whatsappNumber}`,
          });
      } else {
        // SMS
        await this.client.conversations.v1
          .conversations(conversationSid)
          .participants.create({
            'messagingBinding.address': targetPhone,
            'messagingBinding.proxyAddress': this.config.twilio.phoneNumber,
          });
      }

      this.logger.log(
        `Participant ${targetPhone} ajouté à la conversation ${conversationSid} (canal: ${channel})`,
      );
    } catch (error) {
      // Si l'ajout du participant échoue, on supprime la conversation orpheline
      this.logger.error(
        `Échec ajout participant ${targetPhone} à ${conversationSid} — suppression conversation`,
        error,
      );
      await this.client.conversations.v1
        .conversations(conversationSid)
        .remove();
      throw error;
    }

    return conversationSid;
  }

  /**
   * Envoie un message dans une Twilio Conversation existante.
   * Twilio délivre le message à tous les participants (le target reçoit le SMS/WhatsApp).
   *
   * @param conversationSid  SID de la Conversation Twilio
   * @param message          Corps du message (realMessage)
   */
  async sendConversationMessage(
    conversationSid: string,
    message: string,
  ): Promise<void> {
    try {
      await this.client.conversations.v1
        .conversations(conversationSid)
        .messages.create({
          body: message,
          author: 'Humlinker',
        });
      this.logger.log(`Message envoyé dans la conversation ${conversationSid}`);
    } catch (error) {
      this.logger.error(
        `Échec envoi message dans la conversation ${conversationSid}`,
        error,
      );
      throw error;
    }
  }
}
