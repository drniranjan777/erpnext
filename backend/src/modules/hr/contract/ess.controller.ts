import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthContext } from '../../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../../common/decorators';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import { contractorSchema, ContractService, markSchema, minWageSchema, wagesSchema, workerSchema } from './contract.service';
import { RegistersService } from './registers.service';
import { claimSchema, decideClaimSchema, SelfServiceService } from './selfservice.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month as YYYY-MM');

/** Contract labour, self-service claims and home, and statutory registers. */
@ApiTags('HR contract labour and self-service')
@ApiBearerAuth()
@Controller('hr')
export class EssController {
  constructor(
    private readonly contract: ContractService,
    private readonly ess: SelfServiceService,
    private readonly registers: RegistersService,
  ) {}

  // ---- contract labour --------------------------------------------------------------------
  @Get('contractors')
  @RequirePermissions('hr.contract.read')
  contractors(@Auth() auth: AuthContext) {
    return this.contract.contractors(auth);
  }
  @Post('contractors')
  @RequirePermissions('hr.contract.manage')
  @ApiZodBody(contractorSchema)
  addContractor(@Auth() auth: AuthContext, @Body(body(contractorSchema)) b: z.infer<typeof contractorSchema>) {
    return this.contract.saveContractor(auth, null, b);
  }
  @Put('contractors/:id')
  @RequirePermissions('hr.contract.manage')
  @ApiZodBody(contractorSchema)
  updateContractor(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(contractorSchema)) b: z.infer<typeof contractorSchema>) {
    return this.contract.saveContractor(auth, p.id, b);
  }
  @Get('contract-workers')
  @RequirePermissions('hr.contract.read')
  workers(@Auth() auth: AuthContext, @Query(body(z.object({ contractorId: z.uuid().optional(), current: z.stringbool().optional() }))) q: { contractorId?: string; current?: boolean }) {
    return this.contract.workers(auth, q);
  }
  @Post('contract-workers')
  @RequirePermissions('hr.contract.manage')
  @ApiZodBody(workerSchema)
  addWorker(@Auth() auth: AuthContext, @Body(body(workerSchema)) b: z.infer<typeof workerSchema>) {
    return this.contract.saveWorker(auth, null, b);
  }
  @Put('contract-workers/:id')
  @RequirePermissions('hr.contract.manage')
  @ApiZodBody(workerSchema)
  updateWorker(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(workerSchema)) b: z.infer<typeof workerSchema>) {
    return this.contract.saveWorker(auth, p.id, b);
  }
  @Post('contract-attendance')
  @HttpCode(200)
  @RequirePermissions('hr.contract.manage')
  @ApiZodBody(markSchema)
  mark(@Auth() auth: AuthContext, @Body(body(markSchema)) b: z.infer<typeof markSchema>) {
    return this.contract.mark(auth, b);
  }
  @Get('contract-attendance')
  @RequirePermissions('hr.contract.read')
  muster(@Auth() auth: AuthContext, @Query(body(z.object({ month, contractorId: z.uuid().optional() }))) q: { month: string; contractorId?: string }) {
    return this.contract.muster(auth, q.month, q.contractorId);
  }
  @Post('contract-wages')
  @HttpCode(200)
  @RequirePermissions('hr.contract.manage')
  @ApiZodBody(wagesSchema)
  wages(@Auth() auth: AuthContext, @Body(body(wagesSchema)) b: z.infer<typeof wagesSchema>) {
    return this.contract.recordWages(auth, b);
  }
  @Get('contract-compliance')
  @RequirePermissions('hr.contract.read')
  compliance(@Auth() auth: AuthContext, @Query(body(z.object({ month }))) q: { month: string }) {
    return this.contract.compliance(auth, q.month);
  }
  @Get('minimum-wages')
  @RequirePermissions('hr.contract.read')
  minimumWages(@Auth() auth: AuthContext) {
    return this.contract.minimumWages(auth);
  }
  @Post('minimum-wages')
  @RequirePermissions('hr.contract.manage')
  @ApiZodBody(minWageSchema)
  addMinimumWage(@Auth() auth: AuthContext, @Body(body(minWageSchema)) b: z.infer<typeof minWageSchema>) {
    return this.contract.saveMinimumWage(auth, b);
  }

  // ---- self-service -----------------------------------------------------------------------
  @Get('home')
  home(@Auth() auth: AuthContext) {
    return this.ess.home(auth);
  }
  @Get('claims')
  claims(@Auth() auth: AuthContext, @Query(body(z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() }))) q: { status?: string }) {
    return this.ess.claims(auth, q.status);
  }
  @Post('claims')
  @ApiZodBody(claimSchema)
  claim(@Auth() auth: AuthContext, @Body(body(claimSchema)) b: z.infer<typeof claimSchema>) {
    return this.ess.submit(auth, b);
  }
  @Post('claims/:id/decide')
  @HttpCode(200)
  @ApiZodBody(decideClaimSchema)
  decideClaim(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(decideClaimSchema)) b: z.infer<typeof decideClaimSchema>) {
    return this.ess.decide(auth, p.id, b);
  }
  @Delete('claims/:id')
  withdrawClaim(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.ess.withdraw(auth, p.id);
  }

  // ---- registers --------------------------------------------------------------------------
  @Get('registers')
  @RequirePermissions('hr.registers.read')
  registerList() {
    return this.registers.list();
  }
  @Get('registers/:key')
  @RequirePermissions('hr.registers.read')
  register(@Auth() auth: AuthContext, @Param(body(z.object({ key: z.string().max(40) }))) p: { key: string }, @Query(body(z.object({ month: month.optional(), year: z.coerce.number().int().min(2000).max(2100).optional() }))) q: { month?: string; year?: number }) {
    return this.registers.get(auth, p.key, q);
  }
}
