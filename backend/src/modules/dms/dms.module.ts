import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { DocumentsModule } from '../documents/documents.module';
import { DmsController } from './dms.controller';
import { DmsService } from './dms.service';

/** Distribution management: network, secondary sales, schemes, claims, field force, loyalty. */
@Module({
  imports: [AccountingModule, DocumentsModule],
  controllers: [DmsController],
  providers: [DmsService],
  exports: [DmsService],
})
export class DmsModule {}
