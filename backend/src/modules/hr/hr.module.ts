import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { EmployeesService } from './employees.service';
import { HrController } from './hr.controller';
import { OrgService } from './org.service';

/** Core HR: organisation masters, the employee master and service record, documents and letters. */
@Module({
  imports: [DocumentsModule],
  controllers: [HrController],
  providers: [OrgService, EmployeesService],
  exports: [EmployeesService],
})
export class HrModule {}
