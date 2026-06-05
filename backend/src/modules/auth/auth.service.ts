import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { AuthRepository } from './auth.repository';
import { RegisterDto, UpdateMeDto } from './dto/auth.dto';
import { COOKIE_ACCESS_TOKEN, COOKIE_REFRESH_TOKEN, COOKIE_REFRESH_PATH } from '../../common/constants/auth.constants';
import { parseDurationMs } from '../../common/helpers/parse-duration-ms';
import type { users } from '../../generated/prisma/client';
import type { JwtPayload } from '../../common/guards/jwt-auth.guard';

const BCRYPT_ROUNDS = 12;

interface TokenMeta {
  ip: string;
  userAgent: string;
}

interface IssuedTokens {
  accessToken: string;
  rawRefreshToken: string;
  refreshTokenId: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly repo: AuthRepository,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async validateUser(email: string, password: string): Promise<users | null> {
    const user = await this.repo.findByEmail(email);
    if (!user || !user.is_active || !user.password_hash) return null;
    const valid = await bcrypt.compare(password, user.password_hash);
    return valid ? user : null;
  }

  async login(user: users, res: Response, meta: TokenMeta) {
    const tokens = await this.issueTokens(user, meta);
    this.setAuthCookies(res, tokens);
    await this.repo.updateLastSignIn(user.id);
    return this.formatUser(user);
  }

  async register(dto: RegisterDto, res: Response, meta: TokenMeta) {
    const existing = await this.repo.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already registered');

    const password_hash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.repo.create({ ...dto, password_hash });

    const tokens = await this.issueTokens(user, meta);
    this.setAuthCookies(res, tokens);
    return this.formatUser(user);
  }

  async refresh(rawToken: string, res: Response, meta: TokenMeta) {
    const tokenHash = this.hashToken(rawToken);
    const record = await this.repo.findRefreshTokenByHash(tokenHash);

    if (!record || record.revoked_at) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (record.expires_at < new Date()) {
      await this.repo.revokeRefreshToken(record.id);
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.repo.findById(record.user_id);
    if (!user || !user.is_active) throw new UnauthorizedException('User not found or inactive');

    // Rotate: revoke old, issue new
    const tokens = await this.issueTokens(user, meta);
    await this.repo.revokeRefreshToken(record.id, tokens.refreshTokenId);
    this.setAuthCookies(res, tokens);
    return this.formatUser(user);
  }

  async logout(rawToken: string | undefined, userId: string | undefined, res: Response) {
    if (rawToken && userId) {
      const tokenHash = this.hashToken(rawToken);
      const record = await this.repo.findRefreshTokenByHash(tokenHash);
      if (record && record.user_id === userId) {
        await this.repo.revokeAllUserRefreshTokens(userId);
      }
    }
    this.clearAuthCookies(res);
  }

  async getMe(id: string) {
    const user = await this.repo.findById(id);
    if (!user || !user.is_active) throw new UnauthorizedException('User not found');
    return this.formatUser(user);
  }

  async updateMe(id: string, dto: UpdateMeDto) {
    const user = await this.repo.updateProfile(id, dto);
    return this.formatUser(user);
  }

  private async issueTokens(user: users, meta: TokenMeta): Promise<IssuedTokens> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      user_type: user.user_type,
    };

    const accessToken = this.jwtService.sign(payload);

    // Refresh token: opaque 64-byte hex string stored as SHA-256 hash
    const rawRefreshToken = this.generateSecureToken();
    const tokenHash = this.hashToken(rawRefreshToken);
    const refreshDays = this.config.get<number>('jwt.refreshExpiresInDays', 7);
    const expiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);

    const record = await this.repo.createRefreshToken({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      user_agent: meta.userAgent,
      ip_address: meta.ip,
    });

    return { accessToken, rawRefreshToken, refreshTokenId: record.id };
  }

  private setAuthCookies(res: Response, tokens: IssuedTokens) {
    const isProd = this.config.get('app.nodeEnv') === 'production';
    // lax (not strict) so refresh works when SPA and API are on different ports/subdomains.
    const base = {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax' as const,
      path: '/',
    };
    const refreshDays = this.config.get<number>('jwt.refreshExpiresInDays', 7);
    const accessExpiresIn = this.config.get<string>('jwt.expiresIn', '1h') ?? '1h';
    const accessMaxAge = parseDurationMs(accessExpiresIn, 60 * 60 * 1000);

    res.cookie(COOKIE_ACCESS_TOKEN, tokens.accessToken, {
      ...base,
      maxAge: accessMaxAge,
    });
    res.cookie(COOKIE_REFRESH_TOKEN, tokens.rawRefreshToken, {
      ...base,
      maxAge: refreshDays * 24 * 60 * 60 * 1000,
      path: COOKIE_REFRESH_PATH,
    });
  }

  private clearAuthCookies(res: Response) {
    res.clearCookie(COOKIE_ACCESS_TOKEN, { path: '/' });
    res.clearCookie(COOKIE_REFRESH_TOKEN, { path: COOKIE_REFRESH_PATH });
  }

  private generateSecureToken(): string {
    const a = crypto.randomUUID().replace(/-/g, '');
    const b = crypto.randomUUID().replace(/-/g, '');
    return `${a}${b}`;
  }

  // SHA-256 is deterministic: same input → same hash, enabling DB lookup
  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  formatUser(user: users) {
    return {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      phone: user.phone,
      company: user.company,
      license_number: user.license_number,
      user_type: user.user_type,
      role: user.role,
      is_active: user.is_active,
      last_sign_in_at: user.last_sign_in_at,
      created_at: user.created_at,
    };
  }
}
