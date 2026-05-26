import { Injectable } from '@nestjs/common';
import type { User as PrismaUser } from '@prisma/client';
import { PrismaService } from '../../../database';
import type { User } from '../entities';
import type {
  CreateUserData,
  UpdateUserData,
  UsersRepository,
} from './users.repository';

/**
 * Convertit un enregistrement Prisma en entité User du domaine.
 * Permet d'isoler le reste de l'app de Prisma.
 */
function toUser(record: PrismaUser): User {
  return {
    _id: record.id,
    role: record.role,
    gender: record.gender,
    firstName: record.firstName,
    lastName: record.lastName,
    username: record.username,
    email: record.email,
    phoneNumber: record.phoneNumber,
    language: record.language,
    passwordHash: record.passwordHash,
    authProviders: record.authProviders,
    profilePicture: record.profilePicture,
    isEmailVerified: record.isEmailVerified,
    isPhoneVerified: record.isPhoneVerified,
    isPlaceholder: record.isPlaceholder,
    placeholderSource: record.placeholderSource,
    previousEmails: record.previousEmails,
    previousPhoneNumbers: record.previousPhoneNumbers,
    fcmToken: record.fcmToken,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastLoginAt: record.lastLoginAt,
  };
}

@Injectable()
export class PrismaUsersRepository implements UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    const record = await this.prisma.user.findUnique({ where: { id } });
    return record ? toUser(record) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const record = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    return record ? toUser(record) : null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const record = await this.prisma.user.findUnique({ where: { username } });
    return record ? toUser(record) : null;
  }

  async findByPhoneNumber(phoneNumber: string): Promise<User | null> {
    const record = await this.prisma.user.findUnique({ where: { phoneNumber } });
    return record ? toUser(record) : null;
  }

  /**
   * Recherche par email, username ou téléphone actuel.
   * Utilisé lors de la connexion.
   */
  async findByEmailOrUsernameOrPhone(identifier: string): Promise<User | null> {
    const normalized = identifier.trim();
    const record = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: normalized.toLowerCase() },
          { username: normalized },
          { phoneNumber: normalized },
        ],
      },
    });
    return record ? toUser(record) : null;
  }

  /**
   * Recherche un user dont l'email ou le téléphone apparaît dans
   * previousEmails ou previousPhoneNumbers.
   *
   * Utilisé pour la synchronisation des contacts téléphone :
   * un contact peut avoir l'ancien numéro ou email d'un utilisateur Humlinker.
   */
  async findByPreviousContact(contact: string): Promise<User | null> {
    const normalized = contact.trim().toLowerCase();
    const record = await this.prisma.user.findFirst({
      where: {
        OR: [
          { previousEmails: { has: normalized } },
          { previousPhoneNumbers: { has: normalized } },
        ],
      },
    });
    return record ? toUser(record) : null;
  }

  async create(data: CreateUserData): Promise<User> {
    const record = await this.prisma.user.create({
      data: {
        role: data.role ?? 'user',
        gender: data.gender ?? null,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        username: data.username ?? null,
        email: data.email?.toLowerCase() ?? null,
        phoneNumber: data.phoneNumber ?? null,
        language: data.language,
        passwordHash: data.passwordHash ?? null,
        authProviders: data.authProviders,
        profilePicture: data.profilePicture ?? null,
        isEmailVerified: data.isEmailVerified ?? false,
        isPhoneVerified: data.isPhoneVerified ?? false,
        isPlaceholder: data.isPlaceholder ?? false,
        placeholderSource: data.placeholderSource ?? null,
        previousEmails: data.previousEmails ?? [],
        previousPhoneNumbers: data.previousPhoneNumbers ?? [],
      },
    });
    return toUser(record);
  }

  /**
   * Met à jour un user.
   * Normalise l'email en minuscules si fourni.
   *
   * Retourne null si le user n'existe pas ou si Prisma échoue
   * (contrainte unique violée, etc.).
   */
  async update(id: string, data: UpdateUserData): Promise<User | null> {
    try {
      const record = await this.prisma.user.update({
        where: { id },
        data: {
          ...data,
          email:
            data.email === undefined
              ? undefined
              : data.email?.toLowerCase() ?? null,
        },
      });
      return toUser(record);
    } catch {
      return null;
    }
  }

  async updateLastLoginAt(id: string, date: Date): Promise<User | null> {
    return this.update(id, { lastLoginAt: date });
  }

  /**
   * Recherche des utilisateurs inscrits (non-placeholder) par username,
   * prénom, nom, email ou téléphone (contains, insensible à la casse).
   * Exclut l'appelant et les placeholders.
   */
  async searchUsers(
    query: string,
    excludeUserId: string,
    limit: number,
  ): Promise<User[]> {
    const q = query.trim();
    const records = await this.prisma.user.findMany({
      where: {
        isPlaceholder: false,
        id: { not: excludeUserId },
        OR: [
          { username: { contains: q, mode: 'insensitive' } },
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { phoneNumber: { contains: q } },
        ],
      },
      take: limit,
      orderBy: { username: 'asc' },
    });
    return records.map(toUser);
  }
}
