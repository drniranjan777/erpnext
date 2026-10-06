import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { DebitNotesService } from './debit-notes.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { LandedCostsService } from './landed-costs.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';
import { RequisitionsController } from './requisitions.controller';
import { RequisitionsService } from './requisitions.service';
import { RfqsController } from './rfqs.controller';
import { RfqsService } from './rfqs.service';
import { VendorPerformanceService } from './vendor-performance.service';

/** Procure-to-pay: requisitions, RFQs, purchase orders, goods receipts, bills, debit notes, landed cost. */
@Module({
  imports: [InventoryModule],
  controllers: [RequisitionsController, OrdersController, ReceiptsController, InvoicesController, RfqsController],
  providers: [RequisitionsService, OrdersService, ReceiptsService, InvoicesService, DebitNotesService, LandedCostsService, RfqsService, VendorPerformanceService],
})
export class PurchaseModule {}
