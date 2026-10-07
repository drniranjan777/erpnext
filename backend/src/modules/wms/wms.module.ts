import { Module } from '@nestjs/common';
import { PurchaseModule } from '../purchase/purchase.module';
import { SalesModule } from '../sales/sales.module';
import { WmsFlowController } from './flow.controller';
import { WmsFlowService } from './flow.service';
import { WmsController } from './wms.controller';
import { WmsService } from './wms.service';

/** Warehouse management: locations, bin stock, put-away, docks, picking, packing and loading. */
@Module({
  imports: [PurchaseModule, SalesModule],
  controllers: [WmsController, WmsFlowController],
  providers: [WmsService, WmsFlowService],
  exports: [WmsService],
})
export class WmsModule {}
