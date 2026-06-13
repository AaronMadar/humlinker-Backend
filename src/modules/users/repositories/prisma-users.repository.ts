import { Injectable } from '@nestjs/common';
import type { User as PrismaUser } from '@prisma/client';
import { PrismaService } from '@/database';
import type { User } from '../entities';
import type {
  CreateUserData,
  UpdateUserData,
  UsersRepository,
} from './users.repository';

function toUser(record: PrismaUser): User {
  return {
    _id: record.id,
    role: record.role,
    gender: record.gender,
    firstName: record.firstName,
    lastName: record.lastName,
    pin: record.pin,
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

  async findByPin(pin: string): Promise<User | null> {
    const record = await this.prisma.user.findUnique({
      where: { pin: pin.toUpperCase() },
    });
    return record ? toUser(record) : null;
  }

  async findByPhoneNumber(phoneNumber: string): Promise<User | null> {
    const record = await this.prisma.user.findUnique({ where: { phoneNumber } });
    return record ? toUser(record) : null;
  }

  async findByEmailOrPhone(identifier: string): Promise<User | null> {
    const normalized = identifier.trim();
    const record = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: normalized.toLowerCase() },
          { phoneNumber: normalized },
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
        pin: data.pin,
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
      },
    });
    return toUser(record);
  }

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
}
