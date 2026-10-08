import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

/** Project systems: WBS, budgets, milestones and billing, costs, time, resources, earned value. */
@Module({
  imports: [SalesModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
