import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminRepository } from './admin.repository';
import { PrismaModule } from '../../prisma/prisma.module';
import { RolesGuard } from '../../common/guards';

@Module({
  imports: [PrismaModule],
  controllers: [AdminController],
  providers: [AdminService, AdminRepository, RolesGuard],
  exports: [AdminService],
})
export class AdminModule {}
