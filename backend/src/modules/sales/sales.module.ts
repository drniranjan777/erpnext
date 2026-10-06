import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { CreditNotesService } from './credit-notes.service';
import { DeliveriesService } from './deliveries.service';
import { SalesInvoicesService } from './invoices.service';
import { SalesOrdersService } from './orders.service';
import { QuotationsService } from './quotations.service';
import { SalesController } from './sales.controller';

/** Order-to-cash: quotations, sales orders, deliveries, invoices, credit notes and receivables. */
@Module({
  imports: [InventoryModule],
  controllers: [SalesController],
  providers: [QuotationsService, SalesOrdersService, DeliveriesService, SalesInvoicesService, CreditNotesService],
  exports: [SalesInvoicesService],
})
export class SalesModule {}
