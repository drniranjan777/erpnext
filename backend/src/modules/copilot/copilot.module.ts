import { Module } from '@nestjs/common';
import { ManufacturingModule } from '../manufacturing/manufacturing.module';
import { ReportsModule } from '../reports/reports.module';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { CopilotTools } from './tools';

/** AI Copilot v1: chat over the user's data through permission-checked, read-only tools. */
@Module({
  imports: [ReportsModule, ManufacturingModule],
  controllers: [CopilotController],
  providers: [CopilotService, CopilotTools],
})
export class CopilotModule {}
