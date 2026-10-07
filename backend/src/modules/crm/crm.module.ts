import { Module } from '@nestjs/common';
import { MastersModule } from '../masters/masters.module';
import { SalesModule } from '../sales/sales.module';
import { CpqController } from './cpq.controller';
import { CpqService } from './cpq.service';
import { CrmController, CrmPublicController } from './crm.controller';
import { LeadsService } from './leads.service';
import { PipelineService } from './pipeline.service';
import { SchedulesService } from './schedules.service';

/** CRM (leads, opportunities, activities, targets, web forms), CPQ and customer schedules. */
@Module({
  imports: [MastersModule, SalesModule],
  controllers: [CrmController, CrmPublicController, CpqController],
  providers: [LeadsService, PipelineService, CpqService, SchedulesService],
  exports: [LeadsService, PipelineService, CpqService, SchedulesService],
})
export class CrmModule {}
