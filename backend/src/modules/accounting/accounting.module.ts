import { Module } from '@nestjs/common';
import { ComplianceModule } from '../compliance/compliance.module';
import { AssetsService } from './assets.service';
import { BudgetsService } from './budgets.service';
import { CloseService } from './close.service';
import { InsightsService } from './insights.service';
import { ReportsController } from './reports.controller';
import { StatementsService } from './statements.service';
import { TaxAssetsController } from './tax-assets.controller';
import { TdsService } from './tds.service';
import { AccountingController } from './accounting.controller';
import { AccountsService } from './accounts.service';
import { BankService } from './bank.service';
import { MoneyController } from './money.controller';
import { MoneyService } from './money.service';
import { ReceivablesService } from './receivables.service';
import { JournalsService } from './journals.service';
import { LedgerService } from './ledger.service';
import { PostingRulesService } from './posting-rules.service';

/** General ledger: chart of accounts, posting rules from every module, journals, trial balance. */
@Module({
  imports: [ComplianceModule],
  controllers: [AccountingController, MoneyController, TaxAssetsController, ReportsController],
  providers: [LedgerService, PostingRulesService, JournalsService, AccountsService, MoneyService, ReceivablesService, BankService, TdsService, AssetsService, StatementsService, CloseService, BudgetsService, InsightsService],
  exports: [LedgerService, JournalsService],
})
export class AccountingModule {}
