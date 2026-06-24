/**
 * HumlinkerRepository — interface du repository humlinker.
 */
import type { Humlinker, HumlinkerParticipant, HumlinkerStatus } from '../entities';

export const HUMLINKER_REPOSITORY = Symbol('HUMLINKER_REPOSITORY');

export interface CreateHumlinkerData {
  senderId: string;
  targetId: string;
  mirrorId?: string | null;
  isInitiator?: boolean;
  status?: HumlinkerStatus;
  communicationChannel: Humlinker['communicationChannel'];
  targetContactName: string;
  relationshipType: string;
  title: string;
  senderSnapshot: HumlinkerParticipant;
  targetSnapshot: HumlinkerParticipant;
}

export interface UpdateHumlinkerData {
  mirrorId?: string | null;
  isInitiator?: boolean;
  status?: HumlinkerStatus;
  blockedBy?: string | null;
  lastActivityAt?: Date;
  communicationChannel?: Humlinker['communicationChannel'];
  senderSnapshot?: HumlinkerParticipant;
  targetSnapshot?: HumlinkerParticipant;
}

export interface HumlinkerRepository {
  findById(id: string): Promise<Humlinker | null>;
  findAllByUserId(userId: string, options?: { limit?: number; offset?: number }): Promise<Humlinker[]>;
  findBySenderAndTarget(senderId: string, targetId: string): Promise<Humlinker | null>;
  findAllByTargetId(targetId: string): Promise<Humlinker[]>;
  findAllBySenderId(senderId: string): Promise<Humlinker[]>;
  create(data: CreateHumlinkerData): Promise<Humlinker>;
  update(id: string, data: UpdateHumlinkerData): Promise<Humlinker | null>;
  blockBoth(humhlinkerId: string, mirrorId: string, blockedBy: string): Promise<void>;
}
