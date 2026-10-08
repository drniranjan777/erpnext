import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { todayIST } from '../../common/fiscal-year';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { accrueSchema, consolidateQuery, FinanceService, groupSchema, icSchema, instrumentSchema, linkSchema, ruleSchema, runSchema } from './finance.service';

const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const GR = 'finance.group.read';
const GM = 'finance.group.manage';
const TR = 'finance.treasury.read';
const TM = 'finance.treasury.manage';

@ApiTags('Enterprise finance')
@ApiBearerAuth()
@Controller('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('companies')
  @RequirePermissions(GR)
  companies(@Auth() auth: AuthContext) {
    return this.finance.companies(auth);
  }

  @Post('intercompany/links')
  @HttpCode(200)
  @RequirePermissions(GM)
  @ApiZodBody(linkSchema)
  link(@Auth() auth: AuthContext, @Body(body(linkSchema)) b: z.infer<typeof linkSchema>) {
    return this.finance.link(auth, b);
  }

  @Get('intercompany')
  @RequirePermissions(GR)
  transactions(@Auth() auth: AuthContext) {
    return this.finance.transactions(auth);
  }

  @Post('intercompany')
  @RequirePermissions(GM)
  @ApiZodBody(icSchema)
  create(@Auth() auth: AuthContext, @Body(body(icSchema)) b: z.infer<typeof icSchema>) {
    return this.finance.createTransaction(auth, b);
  }

  @Get('intercompany/reconciliation')
  @RequirePermissions(GR)
  reconciliation(@Auth() auth: AuthContext, @Query(body(z.object({ on: z.iso.date().optional() }))) q: { on?: string }) {
    return this.finance.reconciliation(auth, q.on ?? todayIST());
  }

  @Get('groups')
  @RequirePermissions(GR)
  groups(@Auth() auth: AuthContext) {
    return this.finance.groups(auth);
  }

  @Post('groups')
  @RequirePermissions(GM)
  @ApiZodBody(groupSchema)
  addGroup(@Auth() auth: AuthContext, @Body(body(groupSchema)) b: z.infer<typeof groupSchema>) {
    return this.finance.saveGroup(auth, null, b);
  }

  @Put('groups/:id')
  @RequirePermissions(GM)
  @ApiZodBody(groupSchema)
  updateGroup(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(groupSchema)) b: z.infer<typeof groupSchema>) {
    return this.finance.saveGroup(auth, p.id, b);
  }

  @Get('groups/:id/consolidated')
  @RequirePermissions(GR)
  consolidated(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(body(consolidateQuery)) q: z.infer<typeof consolidateQuery>) {
    return this.finance.consolidated(auth, p.id, q);
  }

  @Get('treasury')
  @RequirePermissions(TR)
  treasury(@Auth() auth: AuthContext) {
    return this.finance.treasury(auth);
  }

  @Post('treasury')
  @RequirePermissions(TM)
  @ApiZodBody(instrumentSchema)
  addInstrument(@Auth() auth: AuthContext, @Body(body(instrumentSchema)) b: z.infer<typeof instrumentSchema>) {
    return this.finance.addInstrument(auth, b);
  }

  @Get('treasury/:id/schedule')
  @RequirePermissions(TR)
  schedule(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.finance.schedule(auth, p.id);
  }

  @Post('treasury/:id/close')
  @HttpCode(200)
  @RequirePermissions(TM)
  close(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(z.object({ status: z.enum(['closed', 'invoked']).default('closed') }))) b: { status: 'closed' | 'invoked' }) {
    return this.finance.closeInstrument(auth, p.id, b.status);
  }

  @Post('treasury/accrue')
  @HttpCode(200)
  @RequirePermissions(TM)
  @ApiZodBody(accrueSchema)
  accrue(@Auth() auth: AuthContext, @Body(body(accrueSchema)) b: z.infer<typeof accrueSchema>) {
    return this.finance.accrue(auth, b);
  }

  @Get('allocations')
  @RequirePermissions(GR)
  rules(@Auth() auth: AuthContext) {
    return this.finance.rules(auth);
  }

  @Post('allocations')
  @RequirePermissions(GM)
  @ApiZodBody(ruleSchema)
  addRule(@Auth() auth: AuthContext, @Body(body(ruleSchema)) b: z.infer<typeof ruleSchema>) {
    return this.finance.saveRule(auth, b);
  }

  @Post('allocations/:id/run')
  @HttpCode(200)
  @RequirePermissions(GM)
  @ApiZodBody(runSchema)
  run(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(runSchema)) b: z.infer<typeof runSchema>) {
    return this.finance.runRule(auth, p.id, b);
  }
}
