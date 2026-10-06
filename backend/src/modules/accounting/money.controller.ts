import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, ApiZodQuery, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { cancelSchema, versionSchema, type CancelInput } from '../documents/documents.schemas';
import { BankService, createFromLineSchema, linesQuerySchema, matchSchema } from './bank.service';
import { adjustSchema, chequeSchema, MONEY_TYPES, MoneyService, moneySchema, updateMoneySchema, writeOffSchema, type MoneyKind } from './money.service';
import { ageingSchema, bankFileSchema, dunningSchema, interestSchema, paymentRunSchema, proposalSchema, ReceivablesService } from './receivables.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const kindIdPipe = new ZodValidationPipe(z.object({ kind: z.enum(MONEY_TYPES), id: z.uuid() }));
const kindPipe = new ZodValidationPipe(z.object({ kind: z.enum(MONEY_TYPES) }));
const versionQuery = new ZodValidationPipe(z.object({ version: z.coerce.number().int() }));
const listSchema = z.object({ status: z.string().optional(), q: z.string().trim().max(60).optional(), partyId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.uuid().optional() });

/** Routes: /accounting/money/{receipt|payment|contra}…, receivables / payables tools, bank reconciliation. */
@ApiTags('Accounting')
@ApiBearerAuth()
@Controller('accounting')
export class MoneyController {
  constructor(
    private readonly money: MoneyService,
    private readonly ar: ReceivablesService,
    private readonly bank: BankService,
  ) {}

  // ---- Receipts, payments, contra ----

  @Get('money/:kind')
  @RequirePermissions('accounting.accounts.read')
  @ApiZodQuery(listSchema)
  list(@Auth() auth: AuthContext, @Param(kindPipe) p: { kind: MoneyKind }, @Query(new ZodValidationPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.money.list(auth, p.kind, q);
  }
  @Get('money/:kind/:id')
  @RequirePermissions('accounting.accounts.read')
  get(@Auth() auth: AuthContext, @Param(kindIdPipe) p: { kind: MoneyKind; id: string }) {
    return this.money.get(auth, p.id);
  }
  @Post('money')
  @RequirePermissions('accounting.money.manage')
  @ApiZodBody(moneySchema)
  create(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(moneySchema)) body: z.infer<typeof moneySchema>, @Req() req: AppRequest) {
    return this.money.create(auth, body, requestMeta(req));
  }
  @Put('money/:kind/:id')
  @RequirePermissions('accounting.money.manage')
  @ApiZodBody(updateMoneySchema)
  update(@Auth() auth: AuthContext, @Param(kindIdPipe) p: { kind: MoneyKind; id: string }, @Body(new ZodValidationPipe(updateMoneySchema)) body: z.infer<typeof updateMoneySchema>, @Req() req: AppRequest) {
    return this.money.update(auth, p.id, { ...body, kind: p.kind }, requestMeta(req));
  }
  @Delete('money/:kind/:id')
  @HttpCode(204)
  @RequirePermissions('accounting.money.manage')
  remove(@Auth() auth: AuthContext, @Param(kindIdPipe) p: { kind: MoneyKind; id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.money.remove(auth, p.kind, p.id, q.version, requestMeta(req));
  }
  @Post('money/:kind/:id/submit')
  @HttpCode(200)
  @RequirePermissions('accounting.money.manage')
  submit(@Auth() auth: AuthContext, @Param(kindIdPipe) p: { kind: MoneyKind; id: string }, @Body(new ZodValidationPipe(versionSchema)) b: { version: number }, @Req() req: AppRequest) {
    return this.money.submit(auth, p.kind, p.id, b.version, requestMeta(req));
  }
  @Post('money/:kind/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('accounting.money.cancel')
  cancel(@Auth() auth: AuthContext, @Param(kindIdPipe) p: { kind: MoneyKind; id: string }, @Body(new ZodValidationPipe(cancelSchema)) b: CancelInput, @Req() req: AppRequest) {
    return this.money.cancel(auth, p.kind, p.id, b.version, b.reason, requestMeta(req));
  }
  @Post('money/:kind/:id/cheque')
  @HttpCode(200)
  @RequirePermissions('accounting.money.cancel')
  @ApiZodBody(chequeSchema)
  cheque(@Auth() auth: AuthContext, @Param(kindIdPipe) p: { kind: MoneyKind; id: string }, @Body(new ZodValidationPipe(chequeSchema)) b: z.infer<typeof chequeSchema>, @Req() req: AppRequest) {
    return this.money.cheque(auth, p.id, b, requestMeta(req));
  }
  @Post('money/:kind/:id/adjust')
  @HttpCode(200)
  @RequirePermissions('accounting.money.manage')
  @ApiZodBody(adjustSchema)
  adjust(@Auth() auth: AuthContext, @Param(kindIdPipe) p: { kind: MoneyKind; id: string }, @Body(new ZodValidationPipe(adjustSchema)) b: z.infer<typeof adjustSchema>, @Req() req: AppRequest) {
    return this.money.adjust(auth, p.id, b, requestMeta(req));
  }
  @Post('write-off')
  @HttpCode(200)
  @RequirePermissions('accounting.money.manage')
  @ApiZodBody(writeOffSchema)
  writeOff(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(writeOffSchema)) b: z.infer<typeof writeOffSchema>, @Req() req: AppRequest) {
    return this.money.writeOff(auth, b, requestMeta(req));
  }

  @Get('open-bills')
  @RequirePermissions('accounting.accounts.read')
  async openBills(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ partyId: z.uuid(), side: z.enum(['receivable', 'payable']) }))) q: { partyId: string; side: 'receivable' | 'payable' }) {
    return this.ar.statement(auth, q.partyId).then((s) => ({ bills: s.openBills.filter((b) => (q.side === 'receivable' ? b.docType === 'sales_invoice' : b.docType === 'purchase_invoice')), advances: s.advances }));
  }

  // ---- Receivables / payables ----

  @Get('ageing')
  @RequirePermissions('accounting.accounts.read')
  @ApiZodQuery(ageingSchema)
  ageing(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(ageingSchema)) q: z.infer<typeof ageingSchema>) {
    return this.ar.ageing(auth, q);
  }
  @Get('statement/:id')
  @RequirePermissions('accounting.accounts.read')
  statement(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(new ZodValidationPipe(z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }))) q: { from?: string; to?: string }) {
    return this.ar.statement(auth, p.id, q.from, q.to);
  }
  @Get('interest')
  @RequirePermissions('accounting.accounts.read')
  @ApiZodQuery(interestSchema)
  interest(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(interestSchema)) q: z.infer<typeof interestSchema>) {
    return this.ar.interest(auth, q);
  }
  @Post('dunning')
  @HttpCode(200)
  @RequirePermissions('accounting.money.manage')
  @ApiZodBody(dunningSchema)
  dunning(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(dunningSchema)) b: z.infer<typeof dunningSchema>) {
    return this.ar.dunning(auth, b);
  }
  @Get('payment-proposal')
  @RequirePermissions('accounting.accounts.read')
  @ApiZodQuery(proposalSchema)
  proposal(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(proposalSchema)) q: z.infer<typeof proposalSchema>) {
    return this.ar.proposal(auth, q);
  }
  @Post('payment-run')
  @HttpCode(200)
  @RequirePermissions('accounting.money.manage')
  @ApiZodBody(paymentRunSchema)
  paymentRun(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(paymentRunSchema)) b: z.infer<typeof paymentRunSchema>, @Req() req: AppRequest) {
    return this.ar.paymentRun(auth, b, requestMeta(req));
  }
  @Get('bank-file')
  @RequirePermissions('accounting.money.manage')
  async bankFile(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(bankFileSchema)) q: z.infer<typeof bankFileSchema>) {
    const f = await this.ar.bankFile(auth, q.ids, q.format);
    const body = Buffer.from(f.csv, 'utf8');
    return new StreamableFile(body, { type: 'text/csv; charset=utf-8', length: body.length, disposition: `attachment; filename="${f.fileName}"` });
  }

  // ---- Bank ----

  @Get('money-accounts')
  @RequirePermissions('accounting.accounts.read')
  moneyAccounts(@Auth() auth: AuthContext) {
    return this.bank.moneyAccounts(auth);
  }
  @Post('bank/:id/statement')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('accounting.bank.reconcile')
  async importStatement(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    if (!req.isMultipart()) throw new BadRequestException('Send the statement as multipart/form-data');
    const file = await req.file();
    if (!file) throw new BadRequestException('No file received');
    const buffer = await file.toBuffer();
    if (file.file.truncated || buffer.length > 10 * 1024 * 1024) throw new BadRequestException('Statements up to 10 MB');
    return this.bank.import(auth, p.id, { buffer, fileName: file.filename || 'statement.csv' });
  }
  @Post('bank/:id/auto-match')
  @HttpCode(200)
  @RequirePermissions('accounting.bank.reconcile')
  autoMatch(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.bank.autoReconcile(auth, p.id);
  }
  @Get('bank/:id/lines')
  @RequirePermissions('accounting.accounts.read')
  @ApiZodQuery(linesQuerySchema)
  lines(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(new ZodValidationPipe(linesQuerySchema)) q: z.infer<typeof linesQuerySchema>) {
    return this.bank.lines(auth, p.id, q);
  }
  @Get('bank/:id/brs')
  @RequirePermissions('accounting.accounts.read')
  brs(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(new ZodValidationPipe(z.object({ asOf: z.iso.date().optional() }))) q: { asOf?: string }) {
    return this.bank.brs(auth, p.id, q.asOf);
  }
  @Post('bank/match')
  @HttpCode(200)
  @RequirePermissions('accounting.bank.reconcile')
  @ApiZodBody(matchSchema)
  match(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(matchSchema)) b: z.infer<typeof matchSchema>) {
    return this.bank.match(auth, b);
  }
  @Post('bank/lines/:id/unmatch')
  @HttpCode(200)
  @RequirePermissions('accounting.bank.reconcile')
  unmatch(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.bank.unmatch(auth, p.id);
  }
  @Post('bank/lines/:id/ignore')
  @HttpCode(200)
  @RequirePermissions('accounting.bank.reconcile')
  ignore(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.bank.ignore(auth, p.id);
  }
  @Post('bank/lines/:id/record')
  @HttpCode(200)
  @RequirePermissions('accounting.bank.reconcile')
  @ApiZodBody(createFromLineSchema)
  record(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(createFromLineSchema)) b: z.infer<typeof createFromLineSchema>, @Req() req: AppRequest) {
    return this.bank.createFromLine(auth, p.id, b, requestMeta(req));
  }
}
