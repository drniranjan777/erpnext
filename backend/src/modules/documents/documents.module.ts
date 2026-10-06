import { Global, Module } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { AttachmentsService } from './attachments.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { NumberingService } from './numbering.service';
import { StorageService } from './storage.service';
import { WorkflowSettingsController } from './workflow-settings.controller';

/** Document framework shared by all transaction modules (purchase, sales, ...). */
@Global()
@Module({
  controllers: [DocumentsController, WorkflowSettingsController],
  providers: [DocumentsService, NumberingService, ApprovalsService, AttachmentsService, StorageService],
  exports: [DocumentsService, NumberingService, ApprovalsService, StorageService],
})
export class DocumentsModule {}
