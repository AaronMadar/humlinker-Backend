/**
 * PrismaHumlinkerRepository
 *
 * Implémentation Prisma du HumlinkerRepository.
 * Convertit les enregistrements Prisma en entités Humlinker du domaine.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database';
import type { Humlinker } from '../entities';
import type {
  CreateHumlinkerData,
  HumlinkerRepository,
  UpdateHumlinkerData,
} from './humlinker.repository';

const DEFAULT_PAGE_SIZE = 30;

@Injectable()
export class PrismaHumlinkerRepository implements HumlinkerRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Lecture ──────────────────────────────────────────────────────────────

  async findById(id: string): Promise<Humlinker | null> {
    const row = await this.prisma.humlinker.findUnique({ where: { id } });
    return row ? this.toHumlinker(row) : null;
  }

  async findAllByUserId(
    userId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<Humlinker[]> {
    const { limit = DEFAULT_PAGE_SIZE, offset = 0 } = options;

    const rows = await this.prisma.humlinker.findMany({
      where: {
        OR: [{ senderId: userId }, { targetId: userId }],
        // Exclure les statuts supprimés si besoin futur
      },
      orderBy: { lastActivityAt: 'desc' },
      take: limit,
      skip: offset,
    });

    return rows.map(this.toHumlinker);
  }

  async findBySenderAndTarget(
    senderId: string,
    targetId: string,
  ): Promise<Humlinker | null> {
    const row = await this.prisma.humlinker.findUnique({
      where: { senderId_targetId: { senderId, targetId } },
    });
    return row ? this.toHumlinker(row) : null;
  }

  // ─── Écriture ─────────────────────────────────────────────────────────────

  async create(data: CreateHumlinkerData): Promise<Humlinker> {
    const row = await this.prisma.humlinker.create({
      data: {
        senderId: data.senderId,
        targetId: data.targetId,
        mirrorId: data.mirrorId ?? null,
        status: data.status ?? 'pending',
        communicationChannel: data.communicationChannel,
        targetContactName: data.targetContactName,
        targetContactEmail: data.targetContactEmail ?? null,
        targetContactPhone: data.targetContactPhone ?? null,
        relationshipType: data.relationshipType,
        title: data.title,
        creatorLanguage: data.creatorLanguage,
        targetLanguage: data.targetLanguage ?? null,
        lastActivityAt: new Date(),
      },
    });
    return this.toHumlinker(row);
  }

  async update(id: string, data: UpdateHumlinkerData): Promise<Humlinker | null> {
    try {
      const row = await this.prisma.humlinker.update({
        where: { id },
        data: {
          ...(data.mirrorId !== undefined && { mirrorId: data.mirrorId }),
          ...(data.status !== undefined && { status: data.status }),
          ...(data.blockedBy !== undefined && { blockedBy: data.blockedBy }),
          ...(data.targetLanguage !== undefined && { targetLanguage: data.targetLanguage }),
          ...(data.lastActivityAt !== undefined && { lastActivityAt: data.lastActivityAt }),
        },
      });
      return this.toHumlinker(row);
    } catch {
      return null;
    }
  }

  async blockBoth(
    humhlinkerId: string,
    mirrorId: string,
    blockedBy: string,
  ): Promise<void> {
    // Transaction pour garantir que les deux sont bloqués ou aucun
    await this.prisma.$transaction([
      this.prisma.humlinker.update({
        where: { id: humhlinkerId },
        data: { status: 'blocked', blockedBy },
      }),
      this.prisma.humlinker.update({
        where: { id: mirrorId },
        data: { status: 'blocked', blockedBy },
      }),
    ]);
  }

  // ─── Mapper ───────────────────────────────────────────────────────────────

  private toHumlinker(row: {
    id: string;
    senderId: string;
    targetId: string;
    mirrorId: string | null;
    status: string;
    blockedBy: string | null;
    communicationChannel: string;
    targetContactName: string;
    targetContactEmail: string | null;
    targetContactPhone: string | null;
    relationshipType: string;
    title: string;
    creatorLanguage: string;
    targetLanguage: string | null;
    lastActivityAt: Date;
    createdAt: Date;
    updatedAt: Date;
  }): Humlinker {
    return {
      _id: row.id,
      senderId: row.senderId,
      targetId: row.targetId,
      mirrorId: row.mirrorId,
      status: row.status as Humlinker['status'],
      blockedBy: row.blockedBy,
      communicationChannel: row.communicationChannel as Humlinker['communicationChannel'],
      targetContactName: row.targetContactName,
      targetContactEmail: row.targetContactEmail,
      targetContactPhone: row.targetContactPhone,
      relationshipType: row.relationshipType,
      title: row.title,
      creatorLanguage: row.creatorLanguage,
      targetLanguage: row.targetLanguage,
      lastActivityAt: row.lastActivityAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
