import { Module } from '@nestjs/common';
import { AdminController, PlatformAdminGuard } from './admin.controller';

@Module({
  controllers: [AdminController],
  providers: [PlatformAdminGuard],
})
export class AdminModule {}
