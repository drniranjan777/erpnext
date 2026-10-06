import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';
import { RequisitionsController } from './requisitions.controller';
import { RequisitionsService } from './requisitions.service';

/** Procure-to-pay: requisitions, purchase orders and goods receipts. */
@Module({
  imports: [InventoryModule],
  controllers: [RequisitionsController, OrdersController, ReceiptsController],
  providers: [RequisitionsService, OrdersService, ReceiptsService],
})
export class PurchaseModule {}
