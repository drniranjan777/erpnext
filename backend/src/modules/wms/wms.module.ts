import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchaseModule } from '../purchase/purchase.module';
import { SalesModule } from '../sales/sales.module';
import { WmsControlController } from './control.controller';
import { WmsControlService } from './control.service';
import { WmsFlowController } from './flow.controller';
import { WmsFlowService } from './flow.service';
import { WmsSmartController } from './smart.controller';
import { WmsSmartService } from './smart.service';
import { WmsController } from './wms.controller';
import { WmsService } from './wms.service';

/** Warehouse management: locations, bin stock, put-away, docks, picking, packing and loading. */
@Module({
  imports: [InventoryModule, PurchaseModule, SalesModule],
  controllers: [WmsController, WmsFlowController, WmsControlController, WmsSmartController],
  providers: [WmsService, WmsFlowService, WmsControlService, WmsSmartService],
  exports: [WmsService],
})
export class WmsModule {}
