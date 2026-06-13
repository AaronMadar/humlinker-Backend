/** ContactsService — supprimé (plus de sync contacts, discovery par PIN uniquement) */
import { Injectable } from '@nestjs/common';

export interface SyncContactsResult {
  matched: unknown[];
  unmatched: unknown[];
}

@Injectable()
export class ContactsService {}
