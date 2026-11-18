/**
 * AiService — IA médiatrice de Humlinker (Gemini).
 *
 * Produit, à partir de ce que le Sender veut dire :
 *  - objectiveMessage : l'intention consolidée, visible par le Sender
 *  - realMessage      : le message intermédiaire envoyé au Target
 * Le prompt (règles de médiation) est dans ai.prompt.ts.
 *
 * Robustesse :
 *  - Règles en `systemInstruction` ; les messages utilisateurs sont transmis
 *    comme DONNÉES JSON → impossible de « sortir » des guillemets pour
 *    injecter des consignes (anti prompt-injection).
 *  - Sortie contrainte par un schéma JSON + validation stricte côté serveur.
 *  - Délai maximal par appel + nouvel essai sur erreur temporaire
 *    (délai dépassé, 429, 5xx, réponse invalide).
 *  - Échec définitif → AiUnavailableException (503 AI_UNAVAILABLE) qui
 *    porte la consommation déjà facturée par Google.
 */
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  GoogleGenerativeAI,
  GoogleGenerativeAIAbortError,
  GoogleGenerativeAIFetchError,
  SchemaType,
  type GenerationConfig,
  type GenerativeModel,
  type ResponseSchema,
} from '@google/generative-ai';
import { APP_CONFIG } from '../../config';
import configuration from '../../config/configuration';
import type { ChatMessage, Draft } from '../humlinker/entities';
import { SYSTEM_INSTRUCTION } from './ai.prompt';

export interface AiUsage {
  /** Tokens envoyés au modèle (prompt) */
  inputTokens: number;
  /** Tokens facturés en sortie (réponse + raisonnement interne du modèle) */
  outputTokens: number;
}

/** Pourquoi l'IA n'a pas produit de nouveau draft (affiché au Sender). */
export type AiNotice = 'out_of_scope' | 'content_refused';

export interface AiDraftResult {
  objectiveMessage: string;
  realMessage: string;
  draftChanged: boolean;
  /** Défini si la demande a été écartée (hors sujet ou contenu refusé) */
  notice: AiNotice | null;
  /** Consommation réelle (tous essais confondus) — sert au calcul du coût */
  usage: AiUsage;
}

export interface AiContext {
  /** Prénom + nom du Sender */
  senderName: string;
  /** Prénom + nom du Target */
  targetName: string;
  /** Langue du Sender — pour l'objectiveMessage */
  senderLanguage: string;
  /** Langue du Target — pour le realMessage */
  targetLanguage: string;
  /** Type de relation (ex : « collègue », « ami ») */
  relationshipType: string;
  /** Drafts envoyés au-delà de la fenêtre de chat (contexte éloigné) */
  lastSentDrafts: Draft[];
  /** Messages du chat AVANT le nouveau message */
  chatHistory: ChatMessage[];
  /** Draft actif actuel — null si premier message */
  currentDraft: Draft | null;
  /** Nouveau message tapé par le Sender */
  newMessage: string;
}

/** 503 — l'IA n'a pas pu répondre. `usage` = tokens déjà facturés. */
export class AiUnavailableException extends HttpException {
  constructor(public readonly usage: AiUsage) {
    super(
      {
        message:
          "L'assistant est momentanément indisponible. Votre message n'a pas été envoyé, réessayez dans un instant.",
        code: 'AI_UNAVAILABLE',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

export class AiInvalidResponseError extends Error {
  override name = 'AiInvalidResponseError';
}

export const EMPTY_OBJECTIVES = [
  'Rien a transmettre pour le moment.',
  'Rien à transmettre pour le moment.',
];

const MAX_FIELD_LENGTH = 8000;
const MAX_ATTEMPTS = 2;

const RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    objectiveMessage: { type: SchemaType.STRING },
    realMessage: { type: SchemaType.STRING },
    draftChanged: { type: SchemaType.BOOLEAN },
    outOfScope: { type: SchemaType.BOOLEAN },
    contentRefused: { type: SchemaType.BOOLEAN },
  },
  required: [
    'objectiveMessage',
    'realMessage',
    'draftChanged',
    'outOfScope',
    'contentRefused',
  ],
};

/** Données envoyées au modèle (sérialisées en JSON). */
export function buildAiPayload(ctx: AiContext): Record<string, unknown> {
  const currentObjective = ctx.currentDraft?.objectiveMessage ?? '';
  const isEmpty =
    !currentObjective || EMPTY_OBJECTIVES.includes(currentObjective);

  return {
    participants: {
      sender: ctx.senderName,
      target: ctx.targetName,
      langue_sender: ctx.senderLanguage,
      langue_target: ctx.targetLanguage,
      relation: ctx.relationshipType,
    },
    historique: ctx.chatHistory
      .filter(
        (m) =>
          m.type === 'text' ||
          m.type === 'draft_snapshot' ||
          m.type === 'target_reply',
      )
      .map((m) => ({
        auteur:
          m.type === 'draft_snapshot'
            ? 'draft_envoye_au_target'
            : m.type === 'target_reply'
              ? 'reponse_du_target'
              : 'sender',
        texte: m.content,
      })),
    anciens_drafts: ctx.lastSentDrafts.map((d) => d.objectiveMessage),
    objectif_actuel: isEmpty ? '' : currentObjective,
    nouveau_message: ctx.newMessage,
  };
}

export interface ParsedAiResponse {
  objectiveMessage: string;
  realMessage: string;
  draftChanged: boolean;
  outOfScope: boolean;
  contentRefused: boolean;
}

/** Valide strictement la réponse du modèle. Lève AiInvalidResponseError sinon. */
export function parseAiResponse(text: string): ParsedAiResponse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AiInvalidResponseError('JSON invalide');
  }
  const r = (raw ?? {}) as Record<string, unknown>;
  if (
    typeof r.objectiveMessage !== 'string' ||
    typeof r.realMessage !== 'string' ||
    typeof r.draftChanged !== 'boolean' ||
    typeof r.outOfScope !== 'boolean' ||
    typeof r.contentRefused !== 'boolean'
  ) {
    throw new AiInvalidResponseError('Champs manquants ou mal typés');
  }
  const objectiveMessage = r.objectiveMessage.trim();
  const realMessage = r.realMessage.trim();
  if (
    objectiveMessage.length > MAX_FIELD_LENGTH ||
    realMessage.length > MAX_FIELD_LENGTH
  ) {
    throw new AiInvalidResponseError('Réponse trop longue');
  }
  const dismissed = r.outOfScope || r.contentRefused;
  if (!dismissed && r.draftChanged && (!objectiveMessage || !realMessage)) {
    throw new AiInvalidResponseError('Draft vide');
  }
  return {
    objectiveMessage,
    realMessage,
    draftChanged: r.draftChanged,
    outOfScope: r.outOfScope,
    contentRefused: r.contentRefused,
  };
}

export function isRetriable(err: unknown): boolean {
  if (
    err instanceof AiInvalidResponseError ||
    err instanceof GoogleGenerativeAIAbortError
  ) {
    return true;
  }
  if (err instanceof GoogleGenerativeAIFetchError) {
    return err.status === undefined || err.status === 429 || err.status >= 500;
  }
  return false;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly model: GenerativeModel;

  constructor(
    @Inject(APP_CONFIG)
    private readonly config: ReturnType<typeof configuration>,
  ) {
    const genAI = new GoogleGenerativeAI(this.config.ai.geminiApiKey);
    const { model, timeoutMs, thinkingBudget, maxOutputTokens } =
      this.config.ai;

    // thinkingConfig n'est pas typé par le SDK 0.24 mais transmis tel quel à l'API
    const generationConfig: GenerationConfig & {
      thinkingConfig?: { thinkingBudget: number };
    } = {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.4,
      // Plafond de sortie (raisonnement compris) : borne le coût d'un appel
      maxOutputTokens,
    };
    // Raisonnement interne du modèle, facturé comme de la sortie.
    // 0 = désactivé ; null = le modèle décide.
    if (thinkingBudget !== null) {
      generationConfig.thinkingConfig = { thinkingBudget };
    }

    this.model = genAI.getGenerativeModel(
      { model, systemInstruction: SYSTEM_INSTRUCTION, generationConfig },
      { timeout: timeoutMs },
    );
  }

  async processUserMessage(context: AiContext): Promise<AiDraftResult> {
    const payload = JSON.stringify(buildAiPayload(context));
    const usage: AiUsage = { inputTokens: 0, outputTokens: 0 };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const result = await this.model.generateContent(payload);
        const meta = result.response.usageMetadata;
        const input = meta?.promptTokenCount ?? 0;
        usage.inputTokens += input;
        // total - prompt = sortie + raisonnement, tous deux facturés au tarif sortie
        usage.outputTokens += Math.max(0, (meta?.totalTokenCount ?? 0) - input);

        const parsed = parseAiResponse(result.response.text());

        if (parsed.outOfScope || parsed.contentRefused) {
          // Rien n'est transmis : le draft actuel reste tel quel
          return {
            objectiveMessage:
              context.currentDraft?.objectiveMessage ?? EMPTY_OBJECTIVES[1],
            realMessage: context.currentDraft?.realMessage ?? '',
            draftChanged: false,
            notice: parsed.contentRefused ? 'content_refused' : 'out_of_scope',
            usage,
          };
        }
        return {
          objectiveMessage: parsed.objectiveMessage,
          realMessage: parsed.realMessage,
          draftChanged: parsed.draftChanged,
          notice: null,
          usage,
        };
      } catch (err) {
        const retry = attempt < MAX_ATTEMPTS && isRetriable(err);
        const e = err as Error;
        this.logger.warn(
          `Gemini essai ${attempt}/${MAX_ATTEMPTS} échoué (${e.name}: ${e.message})${retry ? ' — nouvel essai' : ''}`,
        );
        if (!retry) throw new AiUnavailableException(usage);
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
    throw new AiUnavailableException(usage);
  }
}
