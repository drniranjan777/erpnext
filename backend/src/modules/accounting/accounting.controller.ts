import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, ApiZodQuery, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { cancelSchema, versionSchema, type CancelInput } from '../documents/documents.schemas';
import { AccountsService, costCenterSchema, createAccountSchema, ledgerQuerySchema, periodQuerySchema, settingsSchema, updateAccountSchema } from './accounts.service';
import { createJournalSchema, JournalsService, updateJournalSchema, type CreateJournalInput } from './journals.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const companyQuery = new ZodValidationPipe(z.object({ companyId: z.uuid().optional() }));
const versionQuery = new ZodValidationPipe(z.object({ version: z.coerce.number().int() }));
const listPipe = new ZodValidationPipe(
  z.object({ status: z.string().optional(), q: z.string().trim().max(60).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.uuid().optional() }),
);

@ApiTags('Accounting')
@ApiBearerAuth()
@Controller('accounting')
export class AccountingController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly journals: JournalsService,
  ) {}

  // ---- Settings ----

  @Get('settings')
  @RequirePermissions('accounting.accounts.read')
  settings(@Auth() auth: AuthContext, @Query(companyQuery) q: { companyId?: string }) {
    return this.accounts.getSettings(auth, q.companyId);
  }
  @Put('settings/:id')
  @RequirePermissions('accounting.settings.manage')
  @ApiZodBody(settingsSchema)
  updateSettings(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(settingsSchema)) body: z.infer<typeof settingsSchema>) {
    return this.accounts.updateSettings(auth, p.id, body);
  }
  @Post('settings/:id/initialise')
  @HttpCode(200)
  @RequirePermissions('accounting.settings.manage')
  initialise(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.accounts.initialise(auth, p.id);
  }

  // ---- Chart of accounts ----

  @Get('accounts')
  @RequirePermissions('accounting.accounts.read')
  listAccounts(@Auth() auth: AuthContext, @Query(companyQuery) q: { companyId?: string }) {
    return this.accounts.list(auth, q.companyId);
  }
  @Post('accounts')
  @RequirePermissions('accounting.accounts.manage')
  @ApiZodBody(createAccountSchema)
  createAccount(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createAccountSchema)) body: z.infer<typeof createAccountSchema>) {
    return this.accounts.create(auth, body);
  }
  @Put('accounts/:id')
  @RequirePermissions('accounting.accounts.manage')
  @ApiZodBody(updateAccountSchema)
  updateAccount(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateAccountSchema)) body: z.infer<typeof updateAccountSchema>) {
    return this.accounts.update(auth, p.id, body);
  }

  @Get('cost-centers')
  @RequirePermissions('accounting.accounts.read')
  costCenters(@Auth() auth: AuthContext, @Query(companyQuery) q: { companyId?: string }) {
    return this.accounts.listCostCenters(auth, q.companyId);
  }
  @Post('cost-centers')
  @RequirePermissions('accounting.accounts.manage')
  @ApiZodBody(costCenterSchema)
  createCostCenter(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(costCenterSchema)) body: z.infer<typeof costCenterSchema>) {
    return this.accounts.saveCostCenter(auth, null, body);
  }
  @Put('cost-centers/:id')
  @RequirePermissions('accounting.accounts.manage')
  @ApiZodBody(costCenterSchema)
  updateCostCenter(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(costCenterSchema)) body: z.infer<typeof costCenterSchema>) {
    return this.accounts.saveCostCenter(auth, p.id, body);
  }

  // ---- Reports ----

  @Get('trial-balance')
  @RequirePermissions('accounting.accounts.read')
  @ApiZodQuery(periodQuerySchema)
  trialBalance(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(periodQuerySchema)) q: z.infer<typeof periodQuerySchema>) {
    return this.accounts.trialBalance(auth, q);
  }
  @Get('ledger')
  @RequirePermissions('accounting.accounts.read')
  @ApiZodQuery(ledgerQuerySchema)
  ledger(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(ledgerQuerySchema)) q: z.infer<typeof ledgerQuerySchema>) {
    return this.accounts.accountLedger(auth, q);
  }
  @Get('day-book')
  @RequirePermissions('accounting.accounts.read')
  @ApiZodQuery(periodQuerySchema)
  dayBook(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(periodQuerySchema)) q: z.infer<typeof periodQuerySchema>) {
    return this.accounts.dayBook(auth, q);
  }

  // ---- Journals ----

  @Get('journals')
  @RequirePermissions('accounting.accounts.read')
  listJournals(@Auth() auth: AuthContext, @Query(listPipe) q: { status?: string; q?: string; limit: number; cursor?: string }) {
    return this.journals.list(auth, q);
  }
  @Get('journals/:id')
  @RequirePermissions('accounting.accounts.read')
  getJournal(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.journals.get(auth, p.id);
  }
  @Post('journals')
  @RequirePermissions('accounting.journals.manage')
  @ApiZodBody(createJournalSchema)
  createJournal(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createJournalSchema)) body: CreateJournalInput, @Req() req: AppRequest) {
    return this.journals.create(auth, body, requestMeta(req));
  }
  @Put('journals/:id')
  @RequirePermissions('accounting.journals.manage')
  @ApiZodBody(updateJournalSchema)
  updateJournal(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateJournalSchema)) body: z.infer<typeof updateJournalSchema>, @Req() req: AppRequest) {
    return this.journals.update(auth, p.id, body, requestMeta(req));
  }
  @Delete('journals/:id')
  @HttpCode(204)
  @RequirePermissions('accounting.journals.manage')
  removeJournal(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.journals.remove(auth, p.id, q.version, requestMeta(req));
  }
  @Post('journals/:id/submit')
  @HttpCode(200)
  @RequirePermissions('accounting.journals.manage')
  submitJournal(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(versionSchema)) b: { version: number }, @Req() req: AppRequest) {
    return this.journals.submit(auth, p.id, b.version, requestMeta(req));
  }
  @Post('journals/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('accounting.journals.cancel')
  cancelJournal(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(cancelSchema)) b: CancelInput, @Req() req: AppRequest) {
    return this.journals.cancel(auth, p.id, b.version, b.reason, requestMeta(req));
  }
}
