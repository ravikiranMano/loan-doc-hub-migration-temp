import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { SystemModule } from './modules/system/system.module';
import { AdminModule } from './modules/admin/admin.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { DealsModule } from './modules/deals/deals.module';
import { StorageModule } from './modules/storage/storage.module';
import { GenerationModule } from './modules/generation/generation.module';
import configuration from './config/configuration';
import { appConfig } from './config/app.config';
import { databaseConfig } from './config/database.config';
import { GLOBAL_THROTTLE_LIMIT, THROTTLE_TTL_MS } from './common/constants/throttle.constants';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
      load: [configuration, appConfig, databaseConfig],
    }),
    // Global rate limiter: 200 requests / 60 s per IP (generous default for SPA).
    // Auth endpoints override this with stricter limits via @Throttle().
    ThrottlerModule.forRoot([{ ttl: THROTTLE_TTL_MS, limit: GLOBAL_THROTTLE_LIMIT }]),
    PrismaModule,
    AuthModule,
    HealthModule,
    SystemModule,
    AdminModule,
    ContactsModule,
    DocumentsModule,
    DealsModule,
    StorageModule,
    GenerationModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Apply ThrottlerGuard globally — per-route @Throttle() overrides the default.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
