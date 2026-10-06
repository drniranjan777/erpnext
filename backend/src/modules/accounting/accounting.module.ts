import { Module } from '@nestjs/common';
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
  controllers: [AccountingController, MoneyController],
  providers: [LedgerService, PostingRulesService, JournalsService, AccountsService, MoneyService, ReceivablesService, BankService],
  exports: [LedgerService],
})
export class AccountingModule {}
