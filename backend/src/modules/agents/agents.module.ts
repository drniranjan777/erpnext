import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchaseModule } from '../purchase/purchase.module';
import { ServiceModule } from '../service/service.module';
import { AgentActions } from './actions.service';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';

/** AI agents: scheduled watchers that raise recommendations into the AI Inbox and act within guardrails. */
@Module({
  imports: [InventoryModule, PurchaseModule, ServiceModule],
  controllers: [AgentsController],
  providers: [AgentsService, AgentActions],
  exports: [AgentsService, AgentActions],
})
export class AgentsModule {}
