import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto, UpdateMeDto } from './dto/auth.dto';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators';
import { Public } from '../../common/decorators';
import { COOKIE_REFRESH_TOKEN } from '../../common/constants/auth.constants';
import type { JwtPayload } from '../../common/guards/jwt-auth.guard';
import type { users } from '../../generated/prisma/client';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })  // 10 attempts / 60 s per IP
  async login(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const meta = this.extractMeta(req);
    return this.authService.login(req.user as users, res, meta);
  }

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })   // 5 registrations / 60 s per IP
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const meta = this.extractMeta(req);
    return this.authService.register(dto, res, meta);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })  // 30 refreshes / 60 s per IP
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawToken = (req.cookies as Record<string, string>)?.[COOKIE_REFRESH_TOKEN];
    const meta = this.extractMeta(req);
    return this.authService.refresh(rawToken, res, meta);
  }

  @SkipThrottle()
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawToken = (req.cookies as Record<string, string>)?.[COOKIE_REFRESH_TOKEN];
    await this.authService.logout(rawToken, user?.sub, res);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@CurrentUser() user: JwtPayload) {
    return this.authService.getMe(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateMe(@CurrentUser() user: JwtPayload, @Body() dto: UpdateMeDto) {
    return this.authService.updateMe(user.sub, dto);
  }

  private extractMeta(req: Request) {
    return {
      ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? '',
      userAgent: req.headers['user-agent'] ?? '',
    };
  }
}
