import { Module } from '@nestjs/common';
import { EsgController } from './esg.controller';
import { EsgService } from './esg.service';

/** Sustainability (carbon footprint, BRSR-lite, EPR certificates) and electronics materials compliance. */
@Module({
  controllers: [EsgController],
  providers: [EsgService],
})
export class EsgModule {}
