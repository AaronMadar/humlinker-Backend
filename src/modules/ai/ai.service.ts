/**
 * AiService - Integration Gemini pour Humlinker.
 *
 * Responsabilites STRICTES :
 *  1. Reformuler l'intention du sender en message respectueux, clair et humain
 *  2. Produire un objectiveMessage (resume visible) + realMessage (message final envoye)
 *
 * Reponse de Gemini :
 *  { objectiveMessage, realMessage, draftChanged, outOfScope }
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { APP_CONFIG } from '../../config';
import configuration from '../../config/configuration';
import type { ChatMessage, Draft } from '../humlinker/entities';

export interface AiDraftResult {
  objectiveMessage: string;
  realMessage: string;
  draftChanged: boolean;
}

export interface AiContext {
  /** Prenom + nom du sender - utilise pour signer le realMessage */
  senderName: string;
  /** Prenom + nom du target - utilise dans l'objectiveMessage et le realMessage */
  targetName: string;
  /** Langue du sender - pour chatResponse et objectiveMessage */
  senderLanguage: string;
  /** Langue du target - pour le realMessage */
  targetLanguage: string;
  /** Type de relation (ex: "collegue", "ami") */
  relationshipType: string;
  /** Les 10 derniers drafts envoyes au-dela de la fenetre de chat (contexte eloigne) */
  lastSentDrafts: Draft[];
  /** Messages du chat (inclut text, draft_snapshot, target_reply) */
  chatHistory: ChatMessage[];
  /** Draft actif actuel - null si premier message */
  currentDraft: Draft | null;
  /** Nouveau message tape par l'utilisateur */
  newMessage: string;
}


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
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.4,
      },
    });
  }

  async processUserMessage(context: AiContext): Promise<AiDraftResult> {
    const prompt = this.buildPrompt(context);
    try {
      const result = await this.model.generateContent(prompt);
      const text = result.response.text();
      const parsed = JSON.parse(text) as {
        objectiveMessage: string;
        realMessage: string;
        draftChanged: boolean;
        outOfScope: boolean;
      };

      if (parsed.outOfScope) {
        return {
          objectiveMessage: context.currentDraft?.objectiveMessage ?? 'Rien a transmettre pour le moment.',
          realMessage: context.currentDraft?.realMessage ?? '',
          draftChanged: false,
        };
      }

      return {
        objectiveMessage: parsed.objectiveMessage,
        realMessage: parsed.realMessage,
        draftChanged: parsed.draftChanged,
      };
    } catch (err) {
      this.logger.error('Erreur Gemini generateContent', err);
      throw err;
    }
  }

  private buildPrompt(ctx: AiContext): string {
    // Historique unifie : messages sender, drafts envoyes, reponses target — ordre chronologique
    const historyText = ctx.chatHistory
      .filter((m) => m.type === 'text' || m.type === 'draft_snapshot' || m.type === 'target_reply')
      .map((m) => {
        if (m.type === 'draft_snapshot') {
          return `[Draft envoye au target] : "${m.content}"`;
        }
        if (m.type === 'target_reply') {
          return `[Reponse de ${ctx.targetName}] : "${m.content}"`;
        }
        return `[${ctx.senderName}] : "${m.content}"`;
      })
      .join('\n');

    // Contexte eloigne : drafts envoyes au-dela de la fenetre de chat chargee
    const oldDraftsText = ctx.lastSentDrafts.length
      ? '(Anciens drafts envoyes - contexte eloigne)\n' +
        ctx.lastSentDrafts
          .map((d, i) => `[Draft envoye ${i + 1}] : "${d.objectiveMessage}"`)
          .join('\n')
      : null;

    const currentObjective = ctx.currentDraft?.objectiveMessage ?? '';
    const isFirstMessage =
      !currentObjective ||
      currentObjective === 'Rien a transmettre pour le moment.' ||
      currentObjective === 'Rien à transmettre pour le moment.';

    const firstMsgNote = isFirstMessage
      ? " IMPORTANT : comme il n'y a pas encore d'objectiveMessage, draftChanged est forcement true."
      : '';

    const lines = [
      `Tu es l'IA de la plateforme Humlinker, un SaaS qui permet a deux personnes de communiquer exclusivement par INTERMEDIAIRE. Ce n'est pas une discussion directe comme WhatsApp.`,
      `Voici le fonctionnement de Humlinker :`,
      `Un utilisateur (le Sender) ecrit ce qu'il aimerait dire au destinataire (le Target). Ton role est d'agir en tant qu'intermediaire neutre et diplomate pour analyser son message, le comparer a l'historique, et generer un objet JSON contenant quatre elements distincts.`,
      ``,
      `INFORMATIONS SUR LES PARTICIPANTS :`,
      `- Sender (expediteur) : ${ctx.senderName}`,
      `- Target (destinataire) : ${ctx.targetName}`,
      `- Langue du sender : ${ctx.senderLanguage}`,
      `- Langue du destinataire : ${ctx.targetLanguage}`,
      `- Relation entre les deux : ${ctx.relationshipType}`,
      ``,
      `REGLES ABSOLUES :`,
      `- Tu ne donnes AUCUN conseil, AUCUNE opinion, AUCUNE information exterieure a la reformulation du message.`,
      `- Si la demande du sender n'est PAS liee a l'ecriture ou la reformulation d'un message, mets outOfScope: true.`,
      `- Si le sender envoie plusieurs intentions dans un seul message, tu les combines toutes dans un seul objectiveMessage et un seul realMessage.`,
      ``,
      `CHAMPS A GENERER :`,
      ``,
      `1. "objectiveMessage" : C'est la reformulation propre de la pure intention consolidee du sender. Elle doit etre synthetique, neutre, sans ajouts, redigee d'un point de vue intermediaire ("Vous souhaitez demander a ${ctx.targetName}...", "Vous souhaitez transmettre a ${ctx.targetName}..."), et centree sur l'action finale. CONSIGNE STRICTE : ne perds aucun detail - chaque element, justification, contrainte temporelle ou raison doit y figurer. Redige en ${ctx.senderLanguage}.`,
      ``,
      `2. "realMessage" : C'est le message intermediaire final, poli et diplomate, destine a etre envoye au destinataire. Construit sur la base de l'objectiveMessage. CONSIGNES STRICTES :`,
      `   - C'est un message narratif intermediaire : tu ne dois JAMAIS prendre la peau du sender, ni ecrire a la 1ere personne (ex : ne jamais ecrire "Je m'occupe de ca").`,
      `   - Doit systematiquement commencer sous une forme indirecte comme : "${ctx.senderName} vous partage que...", "${ctx.senderName} souhaite vous informer que...", ou "${ctx.senderName} vous indique que...".`,
      `   - Si plusieurs intentions ont ete exprimees, les rediger dans un seul message coherent et fluide.`,
      `   - Redige en ${ctx.targetLanguage}.`,
      ``,
      `3. "draftChanged" : Booleen. true si le message du sender apporte une modification, un nouvel element ou une correction par rapport a l'objectiveMessage precedent. false si le sender ne fait que confirmer ou repeter sans rien ajouter.${firstMsgNote}`,
      ``,
      `4. "outOfScope" : Booleen. true si la demande du sender ne concerne pas la reformulation ou l'ecriture d'un message.`,
      ``,
      `HISTORIQUE DE LA DISCUSSION :`,
      historyText || 'Aucun echange encore.',
      oldDraftsText ? '\n' + oldDraftsText : '',
      ``,
      `current_objective_message : "${isFirstMessage ? '' : currentObjective}"`,
      ``,
      `[Dernier message sender] : "${ctx.newMessage}"`,
      ``,
      `FORMAT DE REPONSE :`,
      `Reponds UNIQUEMENT en JSON valide, sans texte avant ou apres :`,
      `{`,
      `  "objectiveMessage": "Vous souhaitez...",`,
      `  "realMessage": "...",`,
      `  "draftChanged": true,`,
      `  "outOfScope": false`,
      `}`,
    ];

    return lines.join('\n');
  }
}
