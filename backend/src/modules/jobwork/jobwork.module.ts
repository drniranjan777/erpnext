import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { Itc04Service } from './itc04.service';
import { JobWorkController } from './jobwork.controller';
import { JobWorkService } from './jobwork.service';

/** Job work / sub-contracting: challans to job workers, receipts back, ITC-04. */
@Module({
  imports: [InventoryModule],
  controllers: [JobWorkController],
  providers: [JobWorkService, Itc04Service],
})
export class JobWorkModule {}
