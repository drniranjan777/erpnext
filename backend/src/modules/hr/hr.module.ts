import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { DocumentsModule } from '../documents/documents.module';
import { EmployeesService } from './employees.service';
import { HrController } from './hr.controller';
import { OrgService } from './org.service';
import { LearningService } from './talent/learning.service';
import { LifecycleService } from './talent/lifecycle.service';
import { PerformanceService } from './talent/performance.service';
import { RecruitmentService } from './talent/recruitment.service';
import { TalentController } from './talent/talent.controller';
import { LeaveService } from './time/leave.service';
import { TimeController } from './time/time.controller';
import { TimeService } from './time/time.service';

/** Core HR (organisation, employees, documents, letters) and time and leave. */
@Module({
  imports: [DocumentsModule, AccountingModule],
  controllers: [HrController, TimeController, TalentController],
  providers: [OrgService, EmployeesService, TimeService, LeaveService, RecruitmentService, LifecycleService, PerformanceService, LearningService],
  exports: [EmployeesService, TimeService, LeaveService],
})
export class HrModule {}
