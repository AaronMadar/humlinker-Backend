/**
 * PrismaDraftRepository
 *
 * Implémentation Prisma du DraftRepository.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database';
import type { Draft } from '../../humlinker/entities';
import type {
  CreateDraftData,
  DraftRepository,
  UpdateDraftData,
} from './draft.repository';

@Injectable()
export class PrismaDraftRepository implements DraftRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveDraft(humhlinkerId: string): Promise<Draft | null> {
    const row = await this.prisma.draft.findFirst({
      where: { humhlinkerId, isSent: false },
      orderBy: { version: 'desc' },
    });
    return row ? this.toDraft(row) : null;
  }

  async findLastSentDrafts(humhlinkerId: string, limit: number): Promise<Draft[]> {
    const rows = await this.prisma.draft.findMany({
      where: { humhlinkerId, isSent: true },
      orderBy: { version: 'desc' },
      take: limit,
    });
    // Ordre chronologique pour le contexte IA (du plus ancien au plus récent)
    return rows.reverse().map(this.toDraft);
  }

  async create(data: CreateDraftData): Promise<Draft> {
    const row = await this.prisma.draft.create({
      data: {
        humhlinkerId: data.humhlinkerId,
        objectiveMessage: data.objectiveMessage,
        realMessage: data.realMessage,
        version: data.version,
        isSent: data.isSent ?? false,
      },
    });
    return this.toDraft(row);
  }

  async update(id: string, data: UpdateDraftData): Promise<Draft | null> {
    try {
      const row = await this.prisma.draft.update({
        where: { id },
        data: {
          ...(data.objectiveMessage !== undefined && {
            objectiveMessage: data.objectiveMessage,
          }),
          ...(data.realMessage !== undefined && {
            realMessage: data.realMessage,
          }),
        },
      });
      return this.toDraft(row);
    } catch {
      return null;
    }
  }

  async markAsSent(id: string): Promise<Draft | null> {
    try {
      const row = await this.prisma.draft.update({
        where: { id },
        data: { isSent: true },
      });
      return this.toDraft(row);
    } catch {
      return null;
    }
  }

  private toDraft(row: {
    id: string;
    humhlinkerId: string;
    objectiveMessage: string;
    realMessage: string;
    version: number;
    isSent: boolean;
    createdAt: Date;
  }): Draft {
    return {
      _id: row.id,
      humhlinkerId: row.humhlinkerId,
      objectiveMessage: row.objectiveMessage,
      realMessage: row.realMessage,
      version: row.version,
      isSent: row.isSent,
      createdAt: row.createdAt,
    };
  }
}
