import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { ItemsImporter, OpeningStockImporter, PartiesImporter } from './importers';

@Module({
  imports: [InventoryModule],
  controllers: [ImportsController],
  providers: [ImportsService, ItemsImporter, PartiesImporter, OpeningStockImporter],
})
export class ImportsModule {}
