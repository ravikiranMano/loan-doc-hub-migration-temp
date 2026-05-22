import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import * as jwt from 'jsonwebtoken';
import { Request } from 'express';
import { COOKIE_ACCESS_TOKEN } from '../constants/auth.constants';
import type { JwtPayload } from '../guards/jwt-auth.guard';

const logger = new Logger('AccessTokenVerify');

/** Read Nest access token from httpOnly cookie or Authorization: Bearer. */
export function extractAccessToken(request: Request): string | null {
  const fromCookie = (request.cookies as Record<string, string> | undefined)?.[
    COOKIE_ACCESS_TOKEN
  ];
  if (fromCookie) return fromCookie;

  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7).trim() || null;
  }
  return null;
}

function mapNestPayload(payload: jwt.JwtPayload): JwtPayload {
  return {
    sub: payload.sub as string,
    email: (payload.email as string) ?? '',
    role: (payload.role as string) ?? '',
    user_type: (payload.user_type as string) ?? '',
    iat: payload.iat,
    exp: payload.exp,
  };
}

function mapSupabasePayload(payload: JWTPayload | jwt.JwtPayload): JwtPayload {
  return {
    sub: payload.sub as string,
    email: (payload.email as string) ?? '',
    role: (payload.role as string) ?? '',
    user_type:
      ((payload as jwt.JwtPayload).user_metadata as { user_type?: string } | undefined)
        ?.user_type ?? '',
    iat: payload.iat,
    exp: payload.exp,
  };
}

async function verifySupabaseToken(
  token: string,
  config: ConfigService,
): Promise<JwtPayload | null> {
  const supabaseUrl = config.get<string>('supabase.url');
  const jwtSecret = config.get<string>('supabase.jwtSecret');

  if (supabaseUrl) {
    const base = supabaseUrl.replace(/\/$/, '');
    const jwks = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`));
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: `${base}/auth/v1`,
        audience: 'authenticated',
      });
      return mapSupabasePayload(payload);
    } catch (jwksErr) {
      if (!jwtSecret) throw jwksErr;
    }
  }

  if (jwtSecret) {
    const payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    return mapSupabasePayload(payload);
  }

  return null;
}

/** Verify Nest JWT first, then fall back to legacy Supabase JWT (Bearer migration). */
export async function verifyAccessToken(
  token: string,
  config: ConfigService,
): Promise<JwtPayload> {
  const nestSecret = config.get<string>('jwt.secret');
  if (nestSecret) {
    try {
      const payload = jwt.verify(token, nestSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      if (payload.sub) return mapNestPayload(payload);
    } catch {
      // try Supabase next
    }
  }

  const supabasePayload = await verifySupabaseToken(token, config);
  if (supabasePayload?.sub) return supabasePayload;

  throw new Error('Invalid or expired token');
}

export async function resolveUserFromRequest(
  request: Request,
  config: ConfigService,
): Promise<JwtPayload> {
  const token = extractAccessToken(request);
  if (!token) {
    throw new Error('No authentication token provided');
  }
  try {
    return await verifyAccessToken(token, config);
  } catch (err) {
    logger.warn(
      `JWT verification failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}
