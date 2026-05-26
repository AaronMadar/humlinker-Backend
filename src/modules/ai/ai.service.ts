/**
 * AiService — Intégration Gemini pour Humlinker.
 *
 * Responsabilités STRICTES de l'IA :
 *  1. Reformuler l'intention du sender en message respectueux, clair et humain
 *  2. Produire un objectiveMessage (résumé visible) + realMessage (message final envoyé)
 *  3. Répondre dans le chat UNIQUEMENT sur ce qui touche à la reformulation du message
 *
 * L'IA refuse tout ce qui n'est pas lié à l'écriture du message :
 *  → "Je suis ici uniquement pour retranscrire votre message de façon
 *     respectueuse, claire et humaine."
 *
 * ─── Contexte passé à Gemini ────────────────────────────────────────────────
 *  - Les 3 derniers drafts envoyés (évolution de l'intention)
 *  - L'historique des messages du chat (user + IA) depuis le dernier envoi
 *  - Le draft actif en cours (objectiveMessage uniquement)
 *  - Le nouveau message de l'utilisateur
 *
 * ─── Réponse de Gemini ──────────────────────────────────────────────────────
 *  { chatResponse, objectiveMessage, realMessage, draftChanged }
 *  - chatResponse    : réponse conversationnelle affichée dans le chat
 *  - objectiveMessage: résumé de l'intention (visible par le sender)
 *  - realMessage     : message diplomatique final (JAMAIS montré au sender)
 *  - draftChanged    : true si le draft a été modifié (nouveau contenu à sauvegarder)
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { APP_CONFIG } from '../../config';
import configuration from '../../config/configuration';
import type { ChatMessage, Draft } from '../humlinker/entities';

export interface AiDraftResult {
  /** Réponse conversationnelle de l'IA dans le chat */
  chatResponse: string;
  /** Résumé de l'intention — visible par le sender */
  objectiveMessage: string;
  /** Message diplomatique final — jamais montré au sender */
  realMessage: string;
  /** true si le contenu du draft a réellement changé */
  draftChanged: boolean;
}

export interface AiContext {
  /** Langue du sender (pour la réponse conversationnelle) */
  senderLanguage: string;
  /** Langue du target (pour le realMessage) */
  targetLanguage: string;
  /** Type de relation (ex: "collègue", "ami") */
  relationshipType: string;
  /** Les 3 derniers drafts envoyés (contexte historique) */
  lastSentDrafts: Draft[];
  /** Messages du chat depuis le dernier envoi */
  chatHistory: ChatMessage[];
  /** Draft actif actuel (objectiveMessage) — null si rien à transmettre */
  currentDraft: Draft | null;
  /** Nouveau message tapé par l'utilisateur */
  newMessage: string;
}

const OUT_OF_SCOPE_RESPONSE = {
  fr: "Je suis ici uniquement pour retranscrire votre message de façon respectueuse, claire et humaine.",
  en: "I'm here only to transcribe your message respectfully, clearly and humanely.",
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly genAI: GoogleGenerativeAI;
  private readonly model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;

  constructor(
    @Inject(APP_CONFIG)
    private readonly config: ReturnType<typeof configuration>,
  ) {
    this.genAI = new GoogleGenerativeAI(this.config.ai.geminiApiKey);
    this.model = this.genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.4,
      },
    });
  }

  /**
   * Traite un message de l'utilisateur et retourne la réponse de l'IA
   * avec le draft mis à jour (objectiveMessage + realMessage).
   */
  async processUserMessage(context: AiContext): Promise<AiDraftResult> {
    const prompt = this.buildPrompt(context);

    try {
      const result = await this.model.generateContent(prompt);
      const text = result.response.text();
      const parsed = JSON.parse(text) as {
        chatResponse: string;
        objectiveMessage: string;
        realMessage: string;
        draftChanged: boolean;
        outOfScope: boolean;
      };

      // Si l'IA détecte une question hors scope → réponse fixe, draft inchangé
      if (parsed.outOfScope) {
        return {
          chatResponse:
            OUT_OF_SCOPE_RESPONSE[context.senderLanguage as 'fr' | 'en'] ??
            OUT_OF_SCOPE_RESPONSE.fr,
          objectiveMessage:
            context.currentDraft?.objectiveMessage ?? "Rien à transmettre pour le moment.",
          realMessage: context.currentDraft?.realMessage ?? '',
          draftChanged: false,
        };
      }

      return {
        chatResponse: parsed.chatResponse,
        objectiveMessage: parsed.objectiveMessage,
        realMessage: parsed.realMessage,
        draftChanged: parsed.draftChanged,
      };
    } catch (err) {
      this.logger.error('Erreur Gemini generateContent', err);
      throw err;
    }
  }

  // ─── Prompt builder ───────────────────────────────────────────────────────

  private buildPrompt(ctx: AiContext): string {
    const historyText = ctx.chatHistory
      .filter((m) => m.type === 'text')
      .map((m) => `[${m.role === 'user' ? 'Utilisateur' : 'IA'}]: ${m.content}`)
      .join('\n');

    const sentDraftsText = ctx.lastSentDrafts
      .map(
        (d, i) =>
          `Version envoyée ${i + 1} — Objectif: "${d.objectiveMessage}"`,
      )
      .join('\n');

    const currentDraftText = ctx.currentDraft
      ? `Objectif actuel: "${ctx.currentDraft.objectiveMessage}"`
      : 'Aucun draft en cours.';

    return `
Tu es Humlinker, un assistant IA dont le rôle UNIQUE est de retranscrire l'intention d'un message de façon respectueuse, claire et humaine.

RÈGLES ABSOLUES :
- Tu ne donnes AUCUN conseil, AUCUNE opinion, AUCUNE information extérieure au message
- Tu ne fais AUCUNE démarche hors du périmètre de l'écriture du message
- Si la demande de l'utilisateur n'est PAS liée à la reformulation du message, mets outOfScope: true
- Le realMessage est écrit dans la langue du destinataire (${ctx.targetLanguage})
- Le objectiveMessage et chatResponse sont écrits dans la langue de l'expéditeur (${ctx.senderLanguage})
- Relation entre les deux personnes : ${ctx.relationshipType}

CONTEXTE :
${sentDraftsText ? `Historique des versions précédentes :\n${sentDraftsText}` : 'Premier message.'}

Historique du chat :
${historyText || '(aucun message précédent)'}

${currentDraftText}

Nouveau message de l'utilisateur : "${ctx.newMessage}"

RÉPONDS UNIQUEMENT en JSON valide avec ce format exact :
{
  "chatResponse": "Ta réponse conversationnelle courte à afficher dans le chat (en ${ctx.senderLanguage})",
  "objectiveMessage": "Résumé clair de l'intention globale du sender (en ${ctx.senderLanguage})",
  "realMessage": "Message final diplomatique prêt à être envoyé au destinataire (en ${ctx.targetLanguage})",
  "draftChanged": true/false,
  "outOfScope": true/false
}
`.trim();
  }
}
