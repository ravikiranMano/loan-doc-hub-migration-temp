import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { $Enums } from '../../generated/prisma/client';
import type { users, refresh_tokens } from '../../generated/prisma/client';

interface CreateUserData {
  email: string;
  password_hash: string;
  full_name?: string;
  phone?: string;
  company?: string;
  license_number?: string;
  user_type?: string;
  role?: string;
}

interface CreateRefreshTokenData {
  user_id: string;
  token_hash: string;
  expires_at: Date;
  user_agent?: string;
  ip_address?: string;
}

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<users | null> {
    return this.prisma.users.findUnique({ where: { email: email.toLowerCase().trim() } });
  }

  findById(id: string): Promise<users | null> {
    return this.prisma.users.findUnique({ where: { id } });
  }

  create(data: CreateUserData): Promise<users> {
    return this.prisma.users.create({
      data: {
        email: data.email.toLowerCase().trim(),
        password_hash: data.password_hash,
        full_name: data.full_name,
        phone: data.phone,
        company: data.company,
        license_number: data.license_number,
        user_type: data.user_type ?? 'internal',
        role: (data.role as $Enums.app_role) ?? 'other',
      },
    });
  }

  updateLastSignIn(id: string): Promise<users> {
    return this.prisma.users.update({
      where: { id },
      data: { last_sign_in_at: new Date(), updated_at: new Date() },
    });
  }

  updateProfile(
    id: string,
    data: Partial<Pick<users, 'full_name' | 'phone' | 'company' | 'license_number'>>,
  ): Promise<users> {
    return this.prisma.users.update({
      where: { id },
      data: { ...data, updated_at: new Date() },
    });
  }

  createRefreshToken(data: CreateRefreshTokenData): Promise<refresh_tokens> {
    return this.prisma.refresh_tokens.create({ data });
  }

  findRefreshTokenByHash(tokenHash: string): Promise<refresh_tokens | null> {
    return this.prisma.refresh_tokens.findUnique({ where: { token_hash: tokenHash } });
  }

  revokeRefreshToken(id: string, replacedById?: string): Promise<refresh_tokens> {
    return this.prisma.refresh_tokens.update({
      where: { id },
      data: {
        revoked_at: new Date(),
        ...(replacedById ? { replaced_by_id: replacedById } : {}),
      },
    });
  }

  revokeAllUserRefreshTokens(userId: string): Promise<{ count: number }> {
    return this.prisma.refresh_tokens.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  deleteExpiredRefreshTokens(): Promise<{ count: number }> {
    return this.prisma.refresh_tokens.deleteMany({
      where: { expires_at: { lt: new Date() } },
    });
  }
}
