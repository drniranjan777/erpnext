import { Module } from '@nestjs/common';
import { DashboardsController } from './dashboards.controller';
import { DashboardsService } from './dashboards.service';

/** Role dashboards: widget catalogue, presets and saved layouts. */
@Module({
  controllers: [DashboardsController],
  providers: [DashboardsService],
})
export class DashboardsModule {}
