import { Module } from '@nestjs/common';
import { ComplianceController } from './compliance.controller';
import { EInvoiceService } from './einvoice.service';
import { EwayBillService } from './eway-bill.service';
import { GspService } from './gsp.service';
import { GstReportsService } from './gst-reports.service';

/** GST e-compliance: e-invoice (IRN), e-way bills, HSN summary and documents issued. */
@Module({
  controllers: [ComplianceController],
  providers: [GspService, EInvoiceService, EwayBillService, GstReportsService],
  exports: [EInvoiceService],
})
export class ComplianceModule {}
