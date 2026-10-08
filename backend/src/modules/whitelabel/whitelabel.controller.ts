import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, Public, RequirePermissions } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { PlatformAdminGuard } from '../admin/admin.controller';
import { AllowWhenReadOnly } from '../billing/subscription.guard';
import { brandingSchema, clientSchema, memberSchema, partnerCodeSchema, partnerSchema, payoutSchema, WhiteLabelService } from './whitelabel.service';

const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const M = 'settings.branding.manage';

@ApiTags('White-label')
@ApiBearerAuth()
@Controller()
export class WhiteLabelController {
  constructor(private readonly wl: WhiteLabelService) {}

  /** Any member may read the workspace brand (the app shell uses it). */
  @Get('branding')
  @AllowWhenReadOnly()
  branding(@Auth() auth: AuthContext) {
    return this.wl.get(auth);
  }

  @Put('branding')
  @RequirePermissions(M)
  @ApiZodBody(brandingSchema)
  save(@Auth() auth: AuthContext, @Body(body(brandingSchema)) b: z.infer<typeof brandingSchema>) {
    return this.wl.save(auth, b);
  }

  @Post('branding/verify/:what')
  @HttpCode(200)
  @RequirePermissions(M)
  verify(@Auth() auth: AuthContext, @Param(new ZodValidationPipe(z.object({ what: z.enum(['domain', 'email']) }))) p: { what: 'domain' | 'email' }) {
    return this.wl.verify(auth, p.what);
  }

  @Public()
  @Get('public/branding')
  byHost(@Query(body(z.object({ host: z.string().trim().min(3).max(253) }))) q: { host: string }) {
    return this.wl.byHost(q.host);
  }

  @Get('branding/partner')
  @RequirePermissions(M)
  partner(@Auth() auth: AuthContext) {
    return this.wl.partner(auth);
  }

  @Put('branding/partner')
  @RequirePermissions(M)
  @ApiZodBody(partnerCodeSchema)
  setPartner(@Auth() auth: AuthContext, @Body(body(partnerCodeSchema)) b: { code: string | null }) {
    return this.wl.setPartner(auth, b.code);
  }

  /** Partner portal: open to partner members whatever their workspace role. */
  @Get('partner-portal')
  @AllowWhenReadOnly()
  portal(@Auth() auth: AuthContext) {
    return this.wl.portal(auth);
  }

  @Post('partner-portal/clients')
  @AllowWhenReadOnly()
  @ApiZodBody(clientSchema)
  createClient(@Auth() auth: AuthContext, @Body(body(clientSchema)) b: z.infer<typeof clientSchema>) {
    return this.wl.createClient(auth, b);
  }
}

@ApiTags('Platform admin')
@ApiBearerAuth()
@AllowWhenReadOnly()
@UseGuards(PlatformAdminGuard)
@Controller('admin/partners')
export class PartnersAdminController {
  constructor(private readonly wl: WhiteLabelService) {}

  @Get()
  list(@Auth() auth: AuthContext) {
    return this.wl.adminPartners(auth);
  }

  @Post()
  @ApiZodBody(partnerSchema)
  create(@Auth() auth: AuthContext, @Body(body(partnerSchema)) b: z.infer<typeof partnerSchema>) {
    return this.wl.adminSave(auth, null, b);
  }

  @Put(':id')
  @ApiZodBody(partnerSchema)
  update(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(partnerSchema)) b: z.infer<typeof partnerSchema>) {
    return this.wl.adminSave(auth, p.id, b);
  }

  @Post(':id/members')
  @ApiZodBody(memberSchema)
  member(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(memberSchema)) b: z.infer<typeof memberSchema>) {
    return this.wl.adminAddMember(auth, p.id, b);
  }

  @Post('commissions/accrue')
  @HttpCode(200)
  accrue(@Auth() auth: AuthContext) {
    return this.wl.adminAccrue(auth);
  }

  @Post(':id/payout')
  @HttpCode(200)
  @ApiZodBody(payoutSchema)
  pay(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(payoutSchema)) b: z.infer<typeof payoutSchema>) {
    return this.wl.adminPay(auth, p.id, b.reference);
  }
}
