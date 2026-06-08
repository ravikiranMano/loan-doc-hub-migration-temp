import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentsRepository } from './documents.repository';
import { DocumentDataService } from './document-data.service';
import { DocxtemplaterService } from './docxtemplater.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentsRepository,
    DocumentDataService,
    DocxtemplaterService,
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
