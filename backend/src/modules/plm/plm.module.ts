import { Module } from '@nestjs/common';
import { ManufacturingModule } from '../manufacturing/manufacturing.module';
import { DocStoreService } from './docstore.service';
import { DocStoreController, PlmController } from './plm.controller';
import { PlmService } from './plm.service';

/** PLM-lite (lifecycle, engineering BOM, CAD vault) and document management. */
@Module({
  imports: [ManufacturingModule],
  controllers: [PlmController, DocStoreController],
  providers: [PlmService, DocStoreService],
})
export class PlmModule {}
