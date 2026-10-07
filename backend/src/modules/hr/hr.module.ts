import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { EmployeesService } from './employees.service';
import { HrController } from './hr.controller';
import { OrgService } from './org.service';
import { LeaveService } from './time/leave.service';
import { TimeController } from './time/time.controller';
import { TimeService } from './time/time.service';

/** Core HR (organisation, employees, documents, letters) and time and leave. */
@Module({
  imports: [DocumentsModule],
  controllers: [HrController, TimeController],
  providers: [OrgService, EmployeesService, TimeService, LeaveService],
  exports: [EmployeesService, TimeService, LeaveService],
})
export class HrModule {}
