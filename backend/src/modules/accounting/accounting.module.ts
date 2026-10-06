import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountsService } from './accounts.service';
import { JournalsService } from './journals.service';
import { LedgerService } from './ledger.service';
import { PostingRulesService } from './posting-rules.service';

/** General ledger: chart of accounts, posting rules from every module, journals, trial balance. */
@Module({
  controllers: [AccountingController],
  providers: [LedgerService, PostingRulesService, JournalsService, AccountsService],
  exports: [LedgerService],
})
export class AccountingModule {}
