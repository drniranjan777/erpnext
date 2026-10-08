import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EnterprisePlatformController, ScimController } from './enterprise-platform.controller';
import { ScimService } from './scim.service';
import { SsoService } from './sso.service';
import { TenantDataService } from './tenant-data.service';

/** Enterprise identity (OIDC single sign-on, SCIM) and workspace data (export, import, sandbox, residency). */
@Module({
  imports: [AuthModule],
  controllers: [EnterprisePlatformController, ScimController],
  providers: [SsoService, ScimService, TenantDataService],
})
export class EnterprisePlatformModule {}
