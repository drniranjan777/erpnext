import { Module } from '@nestjs/common';
import { HseController } from './hse.controller';
import { HseService } from './hse.service';

/** Chemical HSE pack: safety data sheets, GHS labels, hazardous storage limits, permits to work. */
@Module({
  controllers: [HseController],
  providers: [HseService],
})
export class HsePackModule {}
