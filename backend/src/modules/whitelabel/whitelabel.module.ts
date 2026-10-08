import { Global, Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../admin/admin.controller';
import { PartnersAdminController, WhiteLabelController } from './whitelabel.controller';
import { WhiteLabelService } from './whitelabel.service';

/** White-label branding and partners; global so email delivery can use a workspace's brand. */
@Global()
@Module({
  controllers: [WhiteLabelController, PartnersAdminController],
  providers: [WhiteLabelService, PlatformAdminGuard],
  exports: [WhiteLabelService],
})
export class WhiteLabelModule {}
