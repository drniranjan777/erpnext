import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { StockCountsService } from './stock-counts.service';
import { StockEntriesService } from './stock-entries.service';
import { StockReportsService } from './stock-reports.service';
import { StockService } from './stock.service';

@Module({
  controllers: [InventoryController],
  providers: [StockService, StockEntriesService, StockReportsService, StockCountsService],
  exports: [StockService, StockEntriesService],
})
export class InventoryModule {}
