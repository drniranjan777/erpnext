import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { InventoryModule } from '../inventory/inventory.module';
import { FieldServiceService } from './field.service';
import { ServiceController } from './service.controller';
import { TicketsService } from './tickets.service';

/** After-sales service: tickets with SLAs, knowledge base, warranties, contracts, field visits, RMAs. */
@Module({
  imports: [DocumentsModule, InventoryModule],
  controllers: [ServiceController],
  providers: [TicketsService, FieldServiceService],
  exports: [TicketsService, FieldServiceService],
})
export class ServiceModule {}
