import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { todayIST } from '../../common/fiscal-year';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { PayrollRunsService } from './runs.service';
import { componentSchema, declarationSchema, inputSchema, loanSchema, PayrollSetupService, pieceRateSchema, salarySchema, settingsSchema, templateSchema } from './setup.service';
import { fiscalPosition } from './statutory';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month as YYYY-MM');
const file = (f: { fileName: string; content: string }, type: string) => new StreamableFile(Buffer.from(f.content, 'utf8'), { type, disposition: `attachment; filename="${f.fileName}"` });

@ApiTags('Payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly setup: PayrollSetupService,
    private readonly runs: PayrollRunsService,
  ) {}

  // ---- setup ------------------------------------------------------------------------------
  @Get('settings')
  @RequirePermissions('payroll.salaries.read')
  settings(@Auth() auth: AuthContext) {
    return this.setup.settings(auth);
  }
  @Put('settings')
  @RequirePermissions('payroll.setup.manage')
  @ApiZodBody(settingsSchema)
  saveSettings(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(settingsSchema)) b: z.infer<typeof settingsSchema>) {
    return this.setup.saveSettings(auth, b);
  }
  @Get('components')
  @RequirePermissions('payroll.salaries.read')
  components(@Auth() auth: AuthContext) {
    return this.setup.components(auth);
  }
  @Post('components')
  @RequirePermissions('payroll.setup.manage')
  @ApiZodBody(componentSchema)
  addComponent(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(componentSchema)) b: z.infer<typeof componentSchema>) {
    return this.setup.saveComponent(auth, null, b);
  }
  @Put('components/:id')
  @RequirePermissions('payroll.setup.manage')
  @ApiZodBody(componentSchema)
  updateComponent(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(componentSchema)) b: z.infer<typeof componentSchema>) {
    return this.setup.saveComponent(auth, p.id, b);
  }
  @Get('templates')
  @RequirePermissions('payroll.salaries.read')
  templates(@Auth() auth: AuthContext) {
    return this.setup.templates(auth);
  }
  @Post('templates')
  @RequirePermissions('payroll.setup.manage')
  @ApiZodBody(templateSchema)
  addTemplate(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(templateSchema)) b: z.infer<typeof templateSchema>) {
    return this.setup.saveTemplate(auth, null, b);
  }
  @Put('templates/:id')
  @RequirePermissions('payroll.setup.manage')
  @ApiZodBody(templateSchema)
  updateTemplate(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(templateSchema)) b: z.infer<typeof templateSchema>) {
    return this.setup.saveTemplate(auth, p.id, b);
  }
  @Get('templates/:id/preview')
  @RequirePermissions('payroll.salaries.read')
  preview(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(new ZodValidationPipe(z.object({ ctc: z.coerce.number().positive().max(1e10) }))) q: { ctc: number }) {
    return this.setup.preview(auth, p.id, q.ctc);
  }
  @Get('piece-rates')
  @RequirePermissions('payroll.salaries.read')
  pieceRates(@Auth() auth: AuthContext) {
    return this.setup.pieceRates(auth);
  }
  @Post('piece-rates')
  @RequirePermissions('payroll.setup.manage')
  @ApiZodBody(pieceRateSchema)
  addPieceRate(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(pieceRateSchema)) b: z.infer<typeof pieceRateSchema>) {
    return this.setup.savePieceRate(auth, b);
  }

  // ---- salaries, loans, inputs ------------------------------------------------------------
  @Get('salaries')
  @RequirePermissions('payroll.salaries.read')
  salaries(@Auth() auth: AuthContext) {
    return this.setup.salaries(auth);
  }
  @Get('salaries/:id/history')
  @RequirePermissions('payroll.salaries.read')
  history(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.setup.history(auth, p.id);
  }
  @Post('salaries')
  @RequirePermissions('payroll.salaries.manage')
  @ApiZodBody(salarySchema)
  setSalary(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(salarySchema)) b: z.infer<typeof salarySchema>) {
    return this.setup.setSalary(auth, b);
  }
  @Get('loans')
  @RequirePermissions('payroll.salaries.read')
  loans(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ employeeId: z.uuid().optional() }))) q: { employeeId?: string }) {
    return this.setup.loans(auth, q.employeeId);
  }
  @Post('loans')
  @RequirePermissions('payroll.salaries.manage')
  @ApiZodBody(loanSchema)
  addLoan(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(loanSchema)) b: z.infer<typeof loanSchema>) {
    return this.setup.addLoan(auth, b);
  }
  @Post('loans/:id/close')
  @HttpCode(200)
  @RequirePermissions('payroll.salaries.manage')
  closeLoan(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.setup.closeLoan(auth, p.id);
  }
  @Get('inputs')
  @RequirePermissions('payroll.salaries.read')
  inputs(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ month }))) q: { month: string }) {
    return this.setup.inputs(auth, q.month);
  }
  @Post('inputs')
  @RequirePermissions('payroll.salaries.manage')
  @ApiZodBody(inputSchema)
  addInput(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(inputSchema)) b: z.infer<typeof inputSchema>) {
    return this.setup.addInput(auth, b);
  }
  @Delete('inputs/:id')
  @RequirePermissions('payroll.salaries.manage')
  removeInput(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.setup.removeInput(auth, p.id);
  }

  /** Self-service: an employee's own declaration; HR may pass employeeId. */
  @Get('declarations')
  declaration(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/).optional(), employeeId: z.uuid().optional() }))) q: { fy?: string; employeeId?: string }) {
    return this.setup.declaration(auth, q.fy ?? fiscalPosition(todayIST().slice(0, 7)).fy, q.employeeId);
  }
  @Put('declarations')
  @ApiZodBody(declarationSchema)
  saveDeclaration(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(declarationSchema)) b: z.infer<typeof declarationSchema>) {
    return this.setup.saveDeclaration(auth, b);
  }

  // ---- runs -------------------------------------------------------------------------------
  @Get('runs')
  @RequirePermissions('payroll.runs.read')
  list(@Auth() auth: AuthContext) {
    return this.runs.runs(auth);
  }
  @Post('runs')
  @HttpCode(200)
  @RequirePermissions('payroll.runs.manage')
  compute(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(z.object({ month }))) b: { month: string }) {
    return this.runs.compute(auth, b.month);
  }
  @Get('runs/:id')
  @RequirePermissions('payroll.runs.read')
  get(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.runs.get(auth, p.id);
  }
  @Post('runs/:id/approve')
  @HttpCode(200)
  @RequirePermissions('payroll.runs.approve')
  approve(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.runs.approve(auth, p.id, requestMeta(req));
  }
  @Post('runs/:id/reopen')
  @HttpCode(200)
  @RequirePermissions('payroll.runs.approve')
  reopen(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.runs.reopen(auth, p.id, requestMeta(req));
  }
  @Post('runs/:id/paid')
  @HttpCode(200)
  @RequirePermissions('payroll.runs.approve')
  paid(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(z.object({ paidOn: z.iso.date().optional() }))) b: { paidOn?: string }) {
    return this.runs.markPaid(auth, p.id, b.paidOn ?? todayIST());
  }
  @Get('runs/:id/bank-file')
  @RequirePermissions('payroll.payments.export')
  @Header('cache-control', 'no-store')
  async bankFile(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return file(await this.runs.bankFile(auth, p.id, requestMeta(req)), 'text/csv');
  }
  @Get('runs/:id/ecr')
  @RequirePermissions('payroll.runs.read')
  async ecr(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return file(await this.runs.ecr(auth, p.id), 'text/plain');
  }

  // ---- payslips ---------------------------------------------------------------------------
  @Get('payslips/mine')
  mine(@Auth() auth: AuthContext) {
    return this.runs.myPayslips(auth);
  }
  @Get('payslips/:id')
  payslip(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.runs.payslip(auth, p.id);
  }
}
