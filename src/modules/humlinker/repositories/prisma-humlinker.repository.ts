/**
 * PrismaHumlinkerRepository
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/database';
import type { Humlinker, HumlinkerParticipant } from '../entities';
import type { CreateHumlinkerData, HumlinkerRepository, UpdateHumlinkerData } from './humlinker.repository';

const DEFAULT_PAGE_SIZE = 30;

@Injectable()
export class PrismaHumlinkerRepository implements HumlinkerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Humlinker | null> {
    const row = await this.prisma.humlinker.findUnique({ where: { id } });
    return row ? this.toHumlinker(row as never) : null;
  }

  async findAllByUserId(userId: string, options: { limit?: number; offset?: number } = {}): Promise<Humlinker[]> {
    const { limit = DEFAULT_PAGE_SIZE, offset = 0 } = options;
    const rows = await this.prisma.humlinker.findMany({
      where: { senderId: userId },
      orderBy: { lastActivityAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        chatMessages: {
          where: { type: { in: ['real_message', 'draft_snapshot'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true },
        },
      },
    });
    return rows.map((r) => this.toHumlinker(r as never));
  }

  async findBySenderAndTarget(senderId: string, targetId: string): Promise<Humlinker | null> {
    const row = await this.prisma.humlinker.findUnique({
      where: { senderId_targetId: { senderId, targetId } },
    });
    return row ? this.toHumlinker(row as never) : null;
  }

  async findAllByTargetId(targetId: string): Promise<Humlinker[]> {
    const rows = await this.prisma.humlinker.findMany({ where: { targetId } });
    return rows.map((r) => this.toHumlinker(r as never));
  }

  async findAllBySenderId(senderId: string): Promise<Humlinker[]> {
    const rows = await this.prisma.humlinker.findMany({ where: { senderId } });
    return rows.map((r) => this.toHumlinker(r as never));
  }

  async create(data: CreateHumlinkerData): Promise<Humlinker> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.prisma.humlinker.create as any)({
      data: {
        senderId: data.senderId,
        targetId: data.targetId,
        mirrorId: data.mirrorId ?? null,
        isInitiator: data.isInitiator ?? true,
        status: data.status ?? 'pending',
        communicationChannel: data.communicationChannel,
        targetContactName: data.targetContactName,
        relationshipType: data.relationshipType,
        title: data.title,
        senderSnapshot: data.senderSnapshot,
        targetSnapshot: data.targetSnapshot,
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
          ...(data.isInitiator !== undefined && { isInitiator: data.isInitiator }),
          ...(data.status !== undefined && { status: data.status }),
          ...(data.blockedBy !== undefined && { blockedBy: data.blockedBy }),
          ...(data.lastActivityAt !== undefined && { lastActivityAt: data.lastActivityAt }),
          ...(data.communicationChannel !== undefined && { communicationChannel: data.communicationChannel }),
          ...(data.senderSnapshot !== undefined && { senderSnapshot: data.senderSnapshot as never }),
          ...(data.targetSnapshot !== undefined && { targetSnapshot: data.targetSnapshot as never }),
        },
      });
      return this.toHumlinker(row as never);
    } catch {
      return null;
    }
  }

  async blockBoth(humhlinkerId: string, mirrorId: string, blockedBy: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.humlinker.update({ where: { id: humhlinkerId }, data: { status: 'blocked', blockedBy } }),
      this.prisma.humlinker.update({ where: { id: mirrorId }, data: { status: 'blocked', blockedBy } }),
    ]);
  }

  private toHumlinker(row: {
    id: string;
    senderId: string;
    targetId: string;
    mirrorId: string | null;
    isInitiator: boolean;
    status: string;
    blockedBy: string | null;
    communicationChannel: string;
    targetContactName: string;
    relationshipType: string;
    title: string;
    senderSnapshot: unknown;
    targetSnapshot: unknown;
    lastActivityAt: Date;
    createdAt: Date;
    updatedAt: Date;
    chatMessages?: { content: string }[];
  }): Humlinker {
    return {
      _id: row.id,
      senderId: row.senderId,
      targetId: row.targetId,
      mirrorId: row.mirrorId,
      isInitiator: row.isInitiator,
      status: row.status as Humlinker['status'],
      blockedBy: row.blockedBy,
      communicationChannel: row.communicationChannel as Humlinker['communicationChannel'],
      targetContactName: row.targetContactName,
      relationshipType: row.relationshipType,
      title: row.title,
      sender: row.senderSnapshot as HumlinkerParticipant,
      target: row.targetSnapshot as HumlinkerParticipant,
      lastActivityAt: row.lastActivityAt,
      lastMessage: row.chatMessages?.[0]?.content ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
