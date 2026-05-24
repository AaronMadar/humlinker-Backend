export type HumlinkerChannel = 'whatsapp' | 'sms' | 'email' | 'app';

export interface HumlinkerTargetContact {
  email: string | null;
  phoneNumber: string | null;
}

export interface Humlinker {
  _id: string;
  creatorUserId: string;
  participantUserId: string | null;
  targetContactName: string;
  targetContact: HumlinkerTargetContact;
  relationshipType: string;
  communicationChannel: HumlinkerChannel;
  title: string;
  language: string;
  status: string;
  mirrorHumlinkerId: string | null;
  lastInteractionAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
