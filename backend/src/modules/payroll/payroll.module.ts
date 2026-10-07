import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { DocumentsModule } from '../documents/documents.module';
import { HrModule } from '../hr/hr.module';
import { PayrollController } from './payroll.controller';
import { PayrollRunsService } from './runs.service';
import { PayrollSetupService } from './setup.service';

/** Salaries, statutory deductions, monthly payroll runs, payslips and the salary journal. */
@Module({
  imports: [HrModule, AccountingModule, DocumentsModule],
  controllers: [PayrollController],
  providers: [PayrollSetupService, PayrollRunsService],
  exports: [PayrollSetupService, PayrollRunsService],
})
export class PayrollModule {}
