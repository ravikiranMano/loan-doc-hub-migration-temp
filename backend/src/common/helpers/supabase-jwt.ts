import * as jwt from 'jsonwebtoken';

export interface JwtPayloadClaims {
  role?: string;
  sub?: string;
}

/** Decode JWT payload without verifying (for role checks only). */
export function decodeJwtPayload(token: string): JwtPayloadClaims | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = Buffer.from(part, 'base64url').toString('utf8');
    return JSON.parse(json) as JwtPayloadClaims;
  } catch {
    return null;
  }
}

export function assertServiceRoleJwt(key: string): void {
  const claims = decodeJwtPayload(key);
  if (claims?.role !== 'service_role') {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY must be the service_role JWT from Supabase Dashboard → API keys (not the anon/publishable key).',
    );
  }
}

/** True when SUPABASE_JWT_SECRET is the real Supabase project secret (not Nest JWT_SECRET). */
export function isUsableSupabaseJwtSecret(
  supabaseJwtSecret: string | undefined,
  nestJwtSecret: string | undefined,
): boolean {
  if (!supabaseJwtSecret?.trim()) return false;
  if (nestJwtSecret && supabaseJwtSecret === nestJwtSecret) return false;
  // Supabase legacy JWT secret is a long base64 string; Nest secret is often a short UUID.
  if (supabaseJwtSecret.length < 32) return false;
  return true;
}

/**
 * Mint a short-lived Supabase Auth–compatible access token so edge functions
 * that call auth.getClaims() accept the logged-in user after Nest auth migration.
 */
export function mintSupabaseAccessToken(
  userId: string,
  jwtSecret: string,
  supabaseUrl: string,
): string {
  const iss = `${supabaseUrl.replace(/\/$/, '')}/auth/v1`;
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub: userId,
      role: 'authenticated',
      aud: 'authenticated',
      iss,
      iat: now,
      exp: now + 3600,
    },
    jwtSecret,
    { algorithm: 'HS256' },
  );
}
