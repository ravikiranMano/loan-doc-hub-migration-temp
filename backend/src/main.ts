import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import * as morgan from 'morgan';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JSON_BODY_LIMIT } from './common/constants/limits.constants';

async function bootstrap() {
  // Disable NestJS built-in body parser so we register it once with our limit.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  const port       = configService.get<number>('app.port', 3000);
  const apiPrefix  = configService.get<string>('app.apiPrefix', 'api');
  const corsOrigin = configService.get<string>('app.corsOrigin', 'http://localhost:8080');
  const isProd     = configService.get<string>('app.nodeEnv') === 'production';

  // ── 1. Body parsing ────────────────────────────────────────────────────────
  // Registered first so downstream middleware always sees a parsed body.
  // 10 mb covers large deal JSONB payloads (RE851D, liens, origination fees).
  app.use(json({ limit: JSON_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

  // ── 2. Security headers (Helmet) ───────────────────────────────────────────
  app.use(helmet({
    // CSP disabled in dev (blocks hot-reload scripts); enabled in production.
    contentSecurityPolicy: isProd,
    // Relax COEP so the Office Online doc viewer iframe can load.
    crossOriginEmbedderPolicy: false,
    // HSTS: 1 year, include subdomains — production only.
    hsts: isProd ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  }));

  // ── 3. HTTP access logging (Morgan) ────────────────────────────────────────
  // 'dev' in development (coloured, compact), 'combined' in production (Apache format).
  app.use(morgan(isProd ? 'combined' : 'dev'));

  // ── 4. Cookie parsing ──────────────────────────────────────────────────────
  app.use(cookieParser());

  // ── 5. API prefix & Express tweaks ────────────────────────────────────────
  app.setGlobalPrefix(apiPrefix);

  const expressApp = app.getHttpAdapter().getInstance();
  // SPA client expects a JSON body on every GET — disable Express ETag/304.
  expressApp.set('etag', false);
  expressApp.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    next();
  });

  // ── 6. CORS ────────────────────────────────────────────────────────────────
  // Explicit origin required when credentials: include is used (no wildcard *).
  app.enableCors({
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
  });

  // ── 7. Input validation ────────────────────────────────────────────────────
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,           // strip unknown properties
    transform: true,           // auto-cast primitives
    forbidNonWhitelisted: true, // reject unknown properties as 400
  }));

  // ── 8. Error filters ───────────────────────────────────────────────────────
  // AllExceptionsFilter is outermost (registered first) — catches unhandled
  // Prisma/runtime errors and returns a sanitized 500 in production.
  // HttpExceptionFilter is inner — handles NestJS HttpExceptions (4xx/5xx).
  app.useGlobalFilters(new AllExceptionsFilter(isProd), new HttpExceptionFilter());

  await app.listen(port);

  logger.log(`Environment : ${isProd ? 'production' : 'development'}`);
  logger.log(`Running on  : http://localhost:${port}/${apiPrefix}`);
  logger.log(`Health check: http://localhost:${port}/${apiPrefix}/health`);
}

bootstrap();
