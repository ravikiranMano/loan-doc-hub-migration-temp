import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import * as jwt from 'jsonwebtoken';
import { Request } from 'express';

export interface JwtPayload {
  sub: string;
  email?: string;
  role?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  aud?: string;
  exp?: number;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private readonly jwtSecret?: string;
  private readonly jwks?: ReturnType<typeof createRemoteJWKSet>;
  private readonly jwtIssuer?: string;

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('supabase.url');
    const secret = this.configService.get<string>('supabase.jwtSecret');

    if (supabaseUrl) {
      const base = supabaseUrl.replace(/\/$/, '');
      this.jwks = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`));
      this.jwtIssuer = `${base}/auth/v1`;
    }

    this.jwtSecret = secret;

    if (!this.jwks && !this.jwtSecret) {
      throw new Error('SUPABASE_URL or SUPABASE_JWT_SECRET must be configured');
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('No authentication token provided');
    }

    try {
      request['user'] = await this.verifyToken(token);
      return true;
    } catch (err) {
      this.logger.warn(
        `JWT verification failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private async verifyToken(token: string): Promise<JwtPayload> {
    // Supabase signing keys (ES256) — default for projects using publishable keys
    if (this.jwks && this.jwtIssuer) {
      try {
        const { payload } = await jwtVerify(token, this.jwks, {
          issuer: this.jwtIssuer,
          audience: 'authenticated',
        });
        return this.mapPayload(payload);
      } catch (jwksErr) {
        if (!this.jwtSecret) throw jwksErr;
      }
    }

    // Legacy HS256 JWT secret (older Supabase projects)
    if (this.jwtSecret) {
      const payload = jwt.verify(token, this.jwtSecret, {
        algorithms: ['HS256'],
      }) as jwt.JwtPayload;
      return this.mapPayload(payload);
    }

    throw new Error('No JWT verification method configured');
  }

  private mapPayload(payload: JWTPayload | jwt.JwtPayload): JwtPayload {
    const aud = payload.aud;
    return {
      sub: payload.sub as string,
      email: payload.email as string | undefined,
      role: payload.role as string | undefined,
      app_metadata: payload.app_metadata as Record<string, unknown> | undefined,
      user_metadata: payload.user_metadata as Record<string, unknown> | undefined,
      aud: typeof aud === 'string' ? aud : Array.isArray(aud) ? aud[0] : undefined,
      exp: payload.exp,
    };
  }

  private extractToken(request: Request): string | null {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return null;
    return authHeader.slice(7);
  }
}
