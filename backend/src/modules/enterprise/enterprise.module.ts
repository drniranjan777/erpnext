import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

/** Enterprise finance: inter-company, consolidation, treasury and cost allocation. */
@Module({
  imports: [AccountingModule],
  controllers: [FinanceController],
  providers: [FinanceService],
})
export class EnterpriseModule {}
