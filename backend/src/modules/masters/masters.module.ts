import { Global, Module } from '@nestjs/common';
import { ItemsService } from './items.service';
import { MastersController } from './masters.controller';
import { PartiesService } from './parties.service';
import { SetupService } from './setup.service';

/** Items, customers & vendors, units, item groups, warehouses and price lists (Phase 2). */
@Global()
@Module({
  controllers: [MastersController],
  providers: [ItemsService, PartiesService, SetupService],
  exports: [ItemsService, PartiesService, SetupService],
})
export class MastersModule {}
