import { Module } from '@nestjs/common';
import { TmsController, TmsDriverController } from './tms.controller';
import { TmsService } from './tms.service';

/** Transport (TMS-lite): transporters, rates, trips, driver link, freight bills. */
@Module({
  controllers: [TmsController, TmsDriverController],
  providers: [TmsService],
})
export class TmsModule {}
