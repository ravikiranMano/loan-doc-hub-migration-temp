import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators';
import { resolveUserFromRequest } from '../helpers/access-token.verify';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  user_type: string;
  iat?: number;
  exp?: number;
}

/**
 * Accepts Nest auth via httpOnly cookie (primary) or Authorization Bearer (legacy /
 * non-browser clients). Supabase JWTs in Bearer are still accepted during migration.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    try {
      request['user'] = await resolveUserFromRequest(request, this.config);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
