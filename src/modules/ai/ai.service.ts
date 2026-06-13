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
  /** Langue du sender - pour chatResponse et objectiveMessage */
  senderLanguage: string;
  /** Langue du target - pour le realMessage */
  targetLanguage: string;
  /** Type de relation (ex: "collegue", "ami") */
  relationshipType: string;
  /** Les 10 derniers drafts envoyes (contexte historique) */
  lastSentDrafts: Draft[];
  /** Messages du chat depuis le dernier envoi */
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
    console.log("GEMINI KEY =", process.env.GEMINI_API_KEY?.slice(0, 10));
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
          objectiveMessage: context.currentDraft?.objectiveMessage ?? "Rien a transmettre pour le moment.",
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
    const historyText = ctx.chatHistory
      .filter((m) => m.type === 'text' || m.type === 'target_reply')
      .map((m) => {
        if (m.type === 'target_reply') {
          return `[Humlinker destinataire] : "${m.content}"`;
        }
        return `[${m.role === 'user' ? 'Sender' : 'IA'}] : "${m.content}"`;
      })
      .join('\n');

    const sentDraftsText = ctx.lastSentDrafts.length
      ? ctx.lastSentDrafts
          .map((d, i) => `[Sender objective_message envoye ${i + 1}] : "${d.objectiveMessage}"`)
          .join('\n')
      : null;

    const currentObjective = ctx.currentDraft?.objectiveMessage ?? '';
    const isFirstMessage =
      !currentObjective || currentObjective === 'Rien a transmettre pour le moment.';

    return `
Tu es une IA specialisee dans l'analyse d'intentions et la reformulation de messages.
Ton role est d'analyser le dernier message envoye par le sender, de le comparer a l'historique de la discussion, puis de generer un objet JSON contenant cinq elements distincts.

INFORMATIONS SUR LES PARTICIPANTS :
- Sender (expediteur) : ${ctx.senderName}
- Langue du sender : ${ctx.senderLanguage}
- Langue du destinataire : ${ctx.targetLanguage}
- Relation entre les deux : ${ctx.relationshipType}

REGLES ABSOLUES :
- Tu ne donnes AUCUN conseil, AUCUNE opinion, AUCUNE information exterieure a la reformulation du message
- Si la demande du sender n'est PAS liee a l'ecriture ou la reformulation d'un message, mets outOfScope: true
- Si le sender envoie plusieurs intentions dans un seul message, tu les combines toutes dans un seul objectiveMessage et un seul realMessage

CHAMPS A GENERER :

1. "objectiveMessage" : La pure intention consolidee du sender. Synthetique, neutre, redigee a la 2eme personne ("Vous souhaitez..."), centree sur l'action finale destinee au destinataire. CONSIGNE STRICTE : ne perds aucun detail - chaque element, justification, contrainte temporelle ou raison doit y figurer. Si plusieurs intentions, les combiner en une seule synthese. Redige en ${ctx.senderLanguage}.

2. "realMessage" : Le message diplomatique final, poli et parfaitement mis en forme, destine a etre envoye au destinataire. Construit sur la base de l'objectiveMessage. CONSIGNES STRICTES :
   - Toujours redige a la 3eme personne, jamais du point de vue du sender
   - Doit systematiquement commencer sous une forme indirecte comme : "${ctx.senderName} vous partage que..." ou "${ctx.senderName} souhaite vous informer que..." ou "${ctx.senderName} vous indique que..."
   - Ne jamais ecrire a la 1ere personne du point de vue du sender (ex. : "Je m'occupe de ca")
   - Si plusieurs intentions, les rediger dans un seul message coherent et fluide
   - Redige en ${ctx.targetLanguage}

3. "draftChanged" : Booleen. true si le message du sender apporte une modification, un nouvel element ou une correction par rapport a l'objectiveMessage precedent. false si le sender ne fait que confirmer ou repeter sans rien ajouter.${isFirstMessage ? ' IMPORTANT : comme il n y a pas encore d objectiveMessage, draftChanged est forcement true.' : ''}

4. "outOfScope" : Booleen. true si la demande du sender ne concerne pas la reformulation ou l'ecriture d'un message.

HISTORIQUE DE LA DISCUSSION :
${sentDraftsText ?? 'Aucun message encore envoye.'}
${historyText ? '\n' + historyText : ''}

current_objective_message : "${isFirstMessage ? '' : currentObjective}"

[Dernier message sender] : "${ctx.newMessage}"

FORMAT DE REPONSE :
Reponds UNIQUEMENT en JSON valide, sans texte avant ou apres :
{
  "objectiveMessage": "Vous souhaitez...",
  "realMessage": "...",
  "draftChanged": true,
  "outOfScope": false
}
`.trim();
  }
}
