/**
 * AiService — IA médiatrice de Humlinker (Gemini, SDK officiel @google/genai).
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
  ApiError,
  GoogleGenAI,
  Type,
  type GenerateContentConfig,
  type Schema,
} from '@google/genai';
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
  /** Genre du Sender (profil) — pour accorder le realMessage ; null si inconnu */
  senderGender?: 'male' | 'female' | 'other' | null;
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

/**
 * Filet de sécurité déterministe (en plus du prompt) : généralisations
 * accusatrices SANS ambiguïté dans le message reçu par un Target francophone.
 * « toujours » seul n'y figure pas (il peut signifier « encore »).
 */
const ACCUSATORY_GENERALIZATIONS: Record<string, RegExp> = {
  fr: /comme d'habitude|comme toujours|à chaque fois|c'est toujours|toujours (?:moi|toi|elle|lui|celle|celui) qui|souvent|régulièrement|récurren/i,
};

/** true si le realMessage contient une généralisation accusatrice connue. */
export function hasAccusatoryGeneralization(
  realMessage: string,
  targetLanguage: string,
): boolean {
  return ACCUSATORY_GENERALIZATIONS[targetLanguage]?.test(realMessage) ?? false;
}

/** Alphabet attendu pour les langues à écriture non latine (vérification certaine). */
const REQUIRED_SCRIPT: Record<string, RegExp> = {
  he: /[֐-׿]/,
  ar: /[؀-ۿ]/,
};

/** true si le texte n'est manifestement pas écrit dans la langue attendue. */
export function isWrongScript(text: string, language: string): boolean {
  const script = REQUIRED_SCRIPT[language];
  return !!script && !!text && !script.test(text);
}

/** Langues où le verbe s'accorde au genre de l'interlocuteur (raisonnement activé). */
const GENDERED_GRAMMAR_LANGUAGES = ['he', 'ar'];

const MAX_ATTEMPTS = 2;

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    objectiveMessage: { type: Type.STRING },
    realMessage: { type: Type.STRING },
    draftChanged: { type: Type.BOOLEAN },
    outOfScope: { type: Type.BOOLEAN },
    contentRefused: { type: Type.BOOLEAN },
  },
  required: [
    'objectiveMessage',
    'realMessage',
    'draftChanged',
    'outOfScope',
    'contentRefused',
  ],
  propertyOrdering: [
    'objectiveMessage',
    'realMessage',
    'draftChanged',
    'outOfScope',
    'contentRefused',
  ],
};

/** Noms explicites des langues : un code seul (« he ») est trop discret pour le modèle. */
const LANGUAGE_NAMES: Record<string, string> = {
  fr: 'français',
  en: 'anglais',
  es: 'espagnol',
  ar: 'arabe',
  pt: 'portugais',
  de: 'allemand',
  he: 'hébreu',
};
export const languageLabel = (code: string): string =>
  LANGUAGE_NAMES[code] ? `${LANGUAGE_NAMES[code]} (${code})` : code;

const GENDER_LABELS: Record<string, string> = {
  male: 'homme',
  female: 'femme',
  other: 'non précisé',
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
      genre_sender: GENDER_LABELS[ctx.senderGender ?? ''] ?? 'inconnu',
      langue_sender: languageLabel(ctx.senderLanguage),
      langue_target: languageLabel(ctx.targetLanguage),
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
  if (err instanceof AiInvalidResponseError) return true;
  if (err instanceof ApiError) {
    return err.status === 408 || err.status === 429 || err.status >= 500;
  }
  // Délai dépassé ou coupure réseau (pas de statut HTTP)
  const e = err as Error;
  return (
    e?.name === 'AbortError' ||
    e?.name === 'TimeoutError' ||
    /timeout|timed out|fetch failed|ECONNRESET|ETIMEDOUT|network/i.test(
      e?.message ?? '',
    )
  );
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private readonly generationConfig: GenerateContentConfig;
  /** Même réglage avec un peu de raisonnement, pour les langues à accords complexes */
  private readonly genderedConfig: GenerateContentConfig;

  constructor(
    @Inject(APP_CONFIG)
    private readonly config: ReturnType<typeof configuration>,
  ) {
    const {
      geminiApiKey,
      model,
      timeoutMs,
      thinkingBudget,
      thinkingBudgetGendered,
      maxOutputTokens,
    } = this.config.ai;
    this.ai = new GoogleGenAI({ apiKey: geminiApiKey });
    this.model = model;
    const base: GenerateContentConfig = {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      // Basse : une médiation doit être constante, pas créative
      temperature: 0.2,
      // Plafond de sortie (raisonnement compris) : borne le coût d'un appel
      maxOutputTokens,
      httpOptions: { timeout: timeoutMs },
    };
    // Raisonnement interne, facturé comme de la sortie. 0 = désactivé ; null = le modèle décide.
    const withThinking = (budget: number | null): GenerateContentConfig => ({
      ...base,
      ...(budget !== null
        ? { thinkingConfig: { thinkingBudget: budget } }
        : {}),
    });
    this.generationConfig = withThinking(thinkingBudget);
    this.genderedConfig = withThinking(thinkingBudgetGendered);
  }

  /**
   * Hébreu et arabe accordent le verbe au genre de l'interlocuteur : sans
   * raisonnement, le modèle rapide se trompe (mesuré : 0/5 → 5/5 avec 512 tokens).
   */
  private needsReasoning(context: AiContext): boolean {
    return [context.senderLanguage, context.targetLanguage].some((l) =>
      GENDERED_GRAMMAR_LANGUAGES.includes(l),
    );
  }

  /** Un appel au modèle. Retourne le texte brut et les tokens facturés. */
  private async callModel(
    payload: string,
    context: AiContext,
    correction?: { previous: string; instruction: string },
  ): Promise<{ text: string | undefined; usage: AiUsage }> {
    // Correction ciblée : la réponse précédente + une consigne du SERVEUR, dans
    // des tours séparés (jamais mélangée aux données JSON des utilisateurs)
    const contents = correction
      ? [
          { role: 'user', parts: [{ text: payload }] },
          { role: 'model', parts: [{ text: correction.previous }] },
          { role: 'user', parts: [{ text: correction.instruction }] },
        ]
      : payload;
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents,
      config: this.needsReasoning(context)
        ? this.genderedConfig
        : this.generationConfig,
    });
    const meta = response.usageMetadata;
    return {
      text: response.text,
      usage: {
        inputTokens: meta?.promptTokenCount ?? 0,
        // Réponse + raisonnement : tous deux facturés au tarif sortie
        outputTokens:
          (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
      },
    };
  }

  async processUserMessage(context: AiContext): Promise<AiDraftResult> {
    const payload = JSON.stringify(buildAiPayload(context));
    const usage: AiUsage = { inputTokens: 0, outputTokens: 0 };
    let correction: { previous: string; instruction: string } | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const call = await this.callModel(payload, context, correction);
        correction = undefined;
        usage.inputTokens += call.usage.inputTokens;
        usage.outputTokens += call.usage.outputTokens;

        const parsed = parseAiResponse(call.text ?? '');

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
        // Mauvaise langue (hébreu/arabe attendus mais absents) → on refait une fois
        const wrongLanguage =
          isWrongScript(parsed.objectiveMessage, context.senderLanguage) ||
          isWrongScript(parsed.realMessage, context.targetLanguage);
        // Défauts vérifiables de façon certaine → une correction ciblée ;
        // au dernier essai on accepte (une nuance ne bloque jamais l'utilisateur)
        const generalization = hasAccusatoryGeneralization(
          parsed.realMessage,
          context.targetLanguage,
        );
        if ((wrongLanguage || generalization) && attempt < MAX_ATTEMPTS) {
          const problems = [
            wrongLanguage
              ? `objectiveMessage doit être en ${languageLabel(context.senderLanguage)} et realMessage en ${languageLabel(context.targetLanguage)}`
              : '',
            generalization
              ? 'realMessage contient une généralisation accusatrice (« souvent », « comme d’habitude », « à chaque fois », « c’est toujours… »…) : supprime-la ou remplace-la par le fait précis'
              : '',
          ].filter(Boolean);
          this.logger.warn(
            `Correction demandée (essai ${attempt}) : ${problems.join(' ; ')}`,
          );
          correction = {
            previous: call.text ?? '',
            instruction: `CORRECTION DU SERVEUR HUMLINKER — ta réponse ne respecte pas tes règles : ${problems.join(' ; ')}. Renvoie le JSON complet corrigé, en gardant tout le reste à l'identique.`,
          };
          continue;
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
