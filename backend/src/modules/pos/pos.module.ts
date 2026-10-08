import { Module } from '@nestjs/common';
import { MastersModule } from '../masters/masters.module';
import { SalesModule } from '../sales/sales.module';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

/** Point of sale and the owner's mobile summary. */
@Module({
  imports: [SalesModule, MastersModule],
  controllers: [PosController],
  providers: [PosService],
})
export class PosModule {}
