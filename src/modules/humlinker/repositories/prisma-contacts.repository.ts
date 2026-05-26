/**
 * PrismaContactsRepository
 *
 * Implémentation Prisma du ContactsRepository.
 * Gère le stockage des contacts synchronisés depuis le téléphone de l'utilisateur.
 *
 * ─── Performance ──────────────────────────────────────────────────────────────
 *  Les champs phoneNumbers[] et emails[] sont indexés avec GIN dans PostgreSQL,
 *  ce qui rend les recherches `@>` (contains) très rapides même sur de grands datasets.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database';
import type { Contact } from '../entities';
import type {
  ContactsRepository,
  UpsertContactData,
} from './contacts.repository';

@Injectable()
export class PrismaContactsRepository implements ContactsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Upsert ───────────────────────────────────────────────────────────────

  async upsert(data: UpsertContactData): Promise<Contact> {
    const row = await this.prisma.contact.upsert({
      where: {
        ownerId_name: { ownerId: data.ownerId, name: data.name },
      },
      create: {
        ownerId: data.ownerId,
        name: data.name,
        phoneNumbers: data.phoneNumbers,
        emails: data.emails,
        matchedUserId: data.matchedUserId ?? null,
      },
      update: {
        phoneNumbers: data.phoneNumbers,
        emails: data.emails,
        ...(data.matchedUserId !== undefined && { matchedUserId: data.matchedUserId }),
      },
    });
    return this.toContact(row);
  }

  async upsertMany(dataList: UpsertContactData[]): Promise<Contact[]> {
    // Prisma n'a pas d'upsertMany natif — on utilise une transaction avec Promise.all
    const rows = await this.prisma.$transaction(
      dataList.map((data) =>
        this.prisma.contact.upsert({
          where: {
            ownerId_name: { ownerId: data.ownerId, name: data.name },
          },
          create: {
            ownerId: data.ownerId,
            name: data.name,
            phoneNumbers: data.phoneNumbers,
            emails: data.emails,
            matchedUserId: data.matchedUserId ?? null,
          },
          update: {
            phoneNumbers: data.phoneNumbers,
            emails: data.emails,
            ...(data.matchedUserId !== undefined && { matchedUserId: data.matchedUserId }),
          },
        }),
      ),
    );
    return rows.map(this.toContact);
  }

  // ─── Lecture ──────────────────────────────────────────────────────────────

  async findAllByOwner(ownerId: string): Promise<Contact[]> {
    const rows = await this.prisma.contact.findMany({
      where: { ownerId },
      orderBy: [
        // Contacts matchés (inscrits sur Humlinker) en premier
        { matchedUserId: 'asc' },
        { name: 'asc' },
      ],
    });
    return rows.map(this.toContact);
  }

  async findByMatchedUserId(userId: string): Promise<Contact[]> {
    const rows = await this.prisma.contact.findMany({
      where: { matchedUserId: userId },
    });
    return rows.map(this.toContact);
  }

  // ─── Sync automatique (EventEmitter) ─────────────────────────────────────

  async updateMatchByPhoneOrEmail(
    userId: string,
    phones: string[],
    emails: string[],
  ): Promise<number> {
    // Recherche les contacts dont phoneNumbers ou emails contiennent
    // au moins un des numéros/emails fournis → GIN index utilisé
    const matching = await this.prisma.contact.findMany({
      where: {
        OR: [
          // phoneNumbers @> phones (GIN contains)
          ...phones.map((p) => ({ phoneNumbers: { has: p } })),
          // emails @> emails (GIN contains)
          ...emails.map((e) => ({ emails: { has: e } })),
        ],
        matchedUserId: null, // Ne mettre à jour que ceux qui ne sont pas encore matchés
      },
      select: { id: true },
    });

    if (matching.length === 0) return 0;

    const ids = matching.map((c) => c.id);
    const result = await this.prisma.contact.updateMany({
      where: { id: { in: ids } },
      data: { matchedUserId: userId },
    });

    return result.count;
  }

  async clearStaleMatches(
    userId: string,
    currentPhones: string[],
    currentEmails: string[],
  ): Promise<void> {
    // Contacts qui pointent vers cet userId mais dont AUCUNE coordonnée ne correspond plus
    const stale = await this.prisma.contact.findMany({
      where: {
        matchedUserId: userId,
        AND: [
          // Aucun des numéros courants ne correspond
          ...currentPhones.map((p) => ({ NOT: { phoneNumbers: { has: p } } })),
          // Aucun des emails courants ne correspond
          ...currentEmails.map((e) => ({ NOT: { emails: { has: e } } })),
        ],
      },
      select: { id: true },
    });

    if (stale.length === 0) return;

    await this.prisma.contact.updateMany({
      where: { id: { in: stale.map((c) => c.id) } },
      data: { matchedUserId: null },
    });
  }

  // ─── Mapper ───────────────────────────────────────────────────────────────

  private toContact(row: {
    id: string;
    ownerId: string;
    name: string;
    phoneNumbers: string[];
    emails: string[];
    matchedUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): Contact {
    return {
      _id: row.id,
      ownerId: row.ownerId,
      name: row.name,
      phoneNumbers: row.phoneNumbers,
      emails: row.emails,
      matchedUserId: row.matchedUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
