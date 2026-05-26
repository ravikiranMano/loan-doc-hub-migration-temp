import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';
import { SystemRepository } from './system.repository';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SystemController, MessagesController],
  providers: [SystemService, SystemRepository, MessagesService],
  exports: [SystemService],
})
export class SystemModule {}
