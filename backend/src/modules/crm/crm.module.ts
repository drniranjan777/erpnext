import { Module } from '@nestjs/common';
import { MastersModule } from '../masters/masters.module';
import { SalesModule } from '../sales/sales.module';
import { CrmController, CrmPublicController } from './crm.controller';
import { LeadsService } from './leads.service';
import { PipelineService } from './pipeline.service';

/** Leads, opportunities, activities, territories, targets and web enquiry forms. */
@Module({
  imports: [MastersModule, SalesModule],
  controllers: [CrmController, CrmPublicController],
  providers: [LeadsService, PipelineService],
  exports: [LeadsService, PipelineService],
})
export class CrmModule {}
