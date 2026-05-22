import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { extractAccessToken } from '../../../common/helpers/access-token.verify';
import type { JwtPayload } from '../../../common/guards/jwt-auth.guard';

/** Registered for PassportModule; API routes use JwtAuthGuard directly. */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService) {
    const secret = configService.getOrThrow<string>('jwt.secret');
    super({
      jwtFromRequest: (req: Request) => extractAccessToken(req),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    return payload;
  }
}
