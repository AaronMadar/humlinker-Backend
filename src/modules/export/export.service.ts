/**
 * ExportService — historique daté et vérifiable d'une conversation (preuve en cas de
 * litige, coparentalité…).
 *
 * Contenu exporté (côté du propriétaire uniquement) :
 *  - messages ENVOYÉS  : ChatMessage `draft_snapshot` → texte exact reçu par l'autre
 *                         (Draft.realMessage) + l'aperçu dans la langue de l'expéditeur
 *                         (Draft.senderPreview) s'il diffère ;
 *  - messages REÇUS    : ChatMessage `real_message`.
 * Les échanges privés avec l'IA (`text`) ne sont jamais exportés.
 * `historyClearedAt` est ignoré : « Effacer la discussion » ne masque qu'à l'écran.
 *
 * Intégrité : SHA-256 de la sérialisation JSON canonique du contenu (voir canonical-json.ts),
 * renvoyée avec un identifiant d'export unique.
 */
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { canonicalJson, sha256Canonical } from './canonical-json';

export const EXPORT_FORMAT = 'humlinker-history-export/v1';

export interface ExportParticipant {
  firstName: string | null;
  lastName: string | null;
}

export interface ExportedMessage {
  /** Rang dans l'ordre chronologique, à partir de 1 */
  index: number;
  /** Date/heure ISO 8601 (UTC) de l'échange */
  at: string;
  direction: 'sent' | 'received';
  /** Texte exact transmis à l'autre personne (envoyé) ou reçu */
  text: string;
  /** Envoyé uniquement : le message dans la langue de l'expéditeur, s'il diffère */
  senderPreview?: string;
}

export interface HistoryExportContent {
  format: typeof EXPORT_FORMAT;
  exportId: string;
  humlinkerId: string;
  title: string;
  participants: {
    /** Le propriétaire de l'export (celui qui l'a demandé) */
    owner: ExportParticipant;
    /** L'autre personne de la conversation */
    other: ExportParticipant;
  };
  conversationCreatedAt: string;
  exportedAt: string;
  period: { from: string | null; to: string | null };
  messageCount: number;
  messages: ExportedMessage[];
}

export interface HistoryExport extends HistoryExportContent {
  integrity: {
    algorithm: 'SHA-256';
    canonicalization: string;
    /** Empreinte hexadécimale de canonicalJson(contenu sans `integrity`) */
    hash: string;
  };
}

export const CANONICALIZATION_DESCRIPTION =
  'JSON UTF-8, clés triées par ordre alphabétique (points de code), sans espaces, champ "integrity" exclu';

@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportHistory(humlinkerId: string, userId: string): Promise<HistoryExport> {
    const humlinker = await this.prisma.humlinker.findUnique({
      where: { id: humlinkerId },
      include: {
        senderUser: { select: { firstName: true, lastName: true } },
        targetUser: { select: { firstName: true, lastName: true } },
      },
    });
    if (!humlinker) throw new NotFoundException('Humlinker introuvable.');
    // Chaque côté a son propre exemplaire : on n'exporte que le sien.
    if (humlinker.senderId !== userId) {
      throw new ForbiddenException("Vous ne pouvez exporter que votre propre conversation.");
    }

    // Tout l'historique, même antérieur à historyClearedAt.
    const chatMessages = await this.prisma.chatMessage.findMany({
      where: {
        humhlinkerId: humlinkerId,
        type: { in: ['draft_snapshot', 'real_message'] },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const draftIds = chatMessages
      .map((m) => m.draftId)
      .filter((id): id is string => !!id);
    const drafts = draftIds.length
      ? await this.prisma.draft.findMany({
          where: { id: { in: draftIds }, humhlinkerId: humlinkerId },
        })
      : [];
    const draftsById = new Map(drafts.map((d) => [d.id, d]));

    const messages: ExportedMessage[] = chatMessages.map((m, i) => {
      const base = { index: i + 1, at: m.createdAt.toISOString() };
      if (m.type === 'real_message') {
        return { ...base, direction: 'received' as const, text: m.content };
      }
      const draft = m.draftId ? draftsById.get(m.draftId) : undefined;
      // Sans draft (cas anormal), on garde le contenu affiché dans le chat.
      const text = draft?.realMessage || m.content;
      const preview = draft?.senderPreview;
      return {
        ...base,
        direction: 'sent' as const,
        text,
        ...(preview && preview !== text ? { senderPreview: preview } : {}),
      };
    });

    const otherFromUser: ExportParticipant = {
      firstName: humlinker.targetUser?.firstName ?? null,
      lastName: humlinker.targetUser?.lastName ?? null,
    };
    // Destinataire sans compte (placeholder sans nom) : nom saisi par le propriétaire.
    const other =
      otherFromUser.firstName || otherFromUser.lastName
        ? otherFromUser
        : { firstName: humlinker.targetContactName || null, lastName: null };

    const content: HistoryExportContent = {
      format: EXPORT_FORMAT,
      exportId: this.newExportId(),
      humlinkerId: humlinker.id,
      title: humlinker.title,
      participants: {
        owner: {
          firstName: humlinker.senderUser?.firstName ?? null,
          lastName: humlinker.senderUser?.lastName ?? null,
        },
        other,
      },
      conversationCreatedAt: humlinker.createdAt.toISOString(),
      exportedAt: this.now().toISOString(),
      period: {
        from: messages[0]?.at ?? null,
        to: messages[messages.length - 1]?.at ?? null,
      },
      messageCount: messages.length,
      messages,
    };

    return {
      ...content,
      integrity: {
        algorithm: 'SHA-256',
        canonicalization: CANONICALIZATION_DESCRIPTION,
        hash: sha256Canonical(content),
      },
    };
  }

  /** Recalcule l'empreinte d'un export (pour vérifier qu'il n'a pas été modifié). */
  static computeHash(exported: HistoryExportContent | HistoryExport): string {
    const { integrity: _ignored, ...content } = exported as HistoryExport;
    return sha256Canonical(content);
  }

  static canonical(exported: HistoryExportContent): string {
    return canonicalJson(exported);
  }

  protected now(): Date {
    return new Date();
  }

  protected newExportId(): string {
    return randomUUID();
  }
}
