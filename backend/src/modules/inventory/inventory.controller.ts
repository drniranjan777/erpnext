import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, ApiZodQuery, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { cancelSchema, versionSchema, type CancelInput } from '../documents/documents.schemas';
import {
  addCountLineSchema,
  batchesSchema,
  createStockCountSchema,
  listStockCountsSchema,
  recordCountsSchema,
  updateStockCountSchema,
  type AddCountLineInput,
  type CreateStockCountInput,
  type ListStockCountsQuery,
  type RecordCountsInput,
  type UpdateStockCountInput,
  createStockEntrySchema,
  expiringSchema,
  ledgerSchema,
  listStockEntriesSchema,
  stockLevelsSchema,
  updateStockEntrySchema,
  type CreateStockEntryInput,
  type LedgerQuery,
  type ListStockEntriesQuery,
  type StockLevelsQuery,
  type UpdateStockEntryInput,
} from './inventory.schemas';
import { StockCountsService } from './stock-counts.service';
import { StockEntriesService } from './stock-entries.service';
import { StockReportsService } from './stock-reports.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const versionPipe = new ZodValidationPipe(versionSchema);

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly entries: StockEntriesService,
    private readonly reports: StockReportsService,
    private readonly counts: StockCountsService,
  ) {}

  // ---- Stock entries ----

  @Get('stock-entries')
  @RequirePermissions('inventory.stock.read')
  @ApiZodQuery(listStockEntriesSchema)
  list(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(listStockEntriesSchema)) q: ListStockEntriesQuery) {
    return this.entries.list(auth, q);
  }

  @Get('stock-entries/:id')
  @RequirePermissions('inventory.stock.read')
  get(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.entries.get(auth, p.id);
  }

  @Post('stock-entries')
  @RequirePermissions('inventory.entries.manage')
  @ApiZodBody(createStockEntrySchema)
  create(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createStockEntrySchema)) body: CreateStockEntryInput, @Req() req: AppRequest) {
    return this.entries.create(auth, body, requestMeta(req));
  }

  @Put('stock-entries/:id')
  @RequirePermissions('inventory.entries.manage')
  @ApiZodBody(updateStockEntrySchema)
  update(
    @Auth() auth: AuthContext,
    @Param(idPipe) p: { id: string },
    @Body(new ZodValidationPipe(updateStockEntrySchema)) body: UpdateStockEntryInput,
    @Req() req: AppRequest,
  ) {
    return this.entries.update(auth, p.id, body, requestMeta(req));
  }

  @Delete('stock-entries/:id')
  @HttpCode(204)
  @RequirePermissions('inventory.entries.manage')
  remove(
    @Auth() auth: AuthContext,
    @Param(idPipe) p: { id: string },
    @Query(new ZodValidationPipe(z.object({ version: z.coerce.number().int() }))) q: { version: number },
    @Req() req: AppRequest,
  ) {
    return this.entries.remove(auth, p.id, q.version, requestMeta(req));
  }

  @Post('stock-entries/:id/submit')
  @HttpCode(200)
  @RequirePermissions('inventory.entries.manage')
  @ApiZodBody(versionSchema)
  submit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(versionPipe) body: { version: number }, @Req() req: AppRequest) {
    return this.entries.submit(auth, p.id, body.version, requestMeta(req));
  }

  @Post('stock-entries/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('inventory.entries.cancel')
  @ApiZodBody(cancelSchema)
  cancel(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(cancelSchema)) body: CancelInput, @Req() req: AppRequest) {
    return this.entries.cancel(auth, p.id, body.version, body.reason, requestMeta(req));
  }

  // ---- Physical stock counts ----

  @Get('stock-counts')
  @RequirePermissions('inventory.stock.read')
  @ApiZodQuery(listStockCountsSchema)
  listCounts(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(listStockCountsSchema)) q: ListStockCountsQuery) {
    return this.counts.list(auth, q);
  }

  @Get('stock-counts/:id')
  @RequirePermissions('inventory.stock.read')
  getCount(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.counts.get(auth, p.id);
  }

  @Post('stock-counts')
  @RequirePermissions('inventory.entries.manage')
  @ApiZodBody(createStockCountSchema)
  createCount(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createStockCountSchema)) body: CreateStockCountInput, @Req() req: AppRequest) {
    return this.counts.create(auth, body, requestMeta(req));
  }

  @Put('stock-counts/:id')
  @RequirePermissions('inventory.entries.manage')
  @ApiZodBody(updateStockCountSchema)
  updateCount(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateStockCountSchema)) body: UpdateStockCountInput, @Req() req: AppRequest) {
    return this.counts.update(auth, p.id, body, requestMeta(req));
  }

  /** Enter counted quantities for some lines (no version: several counters may work at once). */
  @Post('stock-counts/:id/counts')
  @HttpCode(200)
  @RequirePermissions('inventory.entries.manage')
  @ApiZodBody(recordCountsSchema)
  recordCounts(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(recordCountsSchema)) body: RecordCountsInput) {
    return this.counts.recordCounts(auth, p.id, body);
  }

  @Post('stock-counts/:id/lines')
  @RequirePermissions('inventory.entries.manage')
  @ApiZodBody(addCountLineSchema)
  addCountLine(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(addCountLineSchema)) body: AddCountLineInput) {
    return this.counts.addLine(auth, p.id, body);
  }

  @Delete('stock-counts/:id')
  @HttpCode(204)
  @RequirePermissions('inventory.entries.manage')
  removeCount(
    @Auth() auth: AuthContext,
    @Param(idPipe) p: { id: string },
    @Query(new ZodValidationPipe(z.object({ version: z.coerce.number().int() }))) q: { version: number },
    @Req() req: AppRequest,
  ) {
    return this.counts.remove(auth, p.id, q.version, requestMeta(req));
  }

  @Post('stock-counts/:id/submit')
  @HttpCode(200)
  @RequirePermissions('inventory.entries.manage')
  @ApiZodBody(versionSchema)
  submitCount(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(versionPipe) body: { version: number }, @Req() req: AppRequest) {
    return this.counts.submit(auth, p.id, body.version, requestMeta(req));
  }

  @Post('stock-counts/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('inventory.entries.cancel')
  @ApiZodBody(cancelSchema)
  cancelCount(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(cancelSchema)) body: CancelInput, @Req() req: AppRequest) {
    return this.counts.cancel(auth, p.id, body.version, body.reason, requestMeta(req));
  }

  // ---- Reports ----

  @Get('stock')
  @RequirePermissions('inventory.stock.read')
  @ApiZodQuery(stockLevelsSchema)
  levels(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(stockLevelsSchema)) q: StockLevelsQuery) {
    return this.reports.levels(auth, q);
  }

  @Get('stock/:id')
  @RequirePermissions('inventory.stock.read')
  item(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.reports.item(auth, p.id);
  }

  @Get('ledger')
  @RequirePermissions('inventory.stock.read')
  @ApiZodQuery(ledgerSchema)
  ledger(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(ledgerSchema)) q: LedgerQuery) {
    return this.reports.ledger(auth, q);
  }

  @Get('batches')
  @RequirePermissions('inventory.stock.read')
  @ApiZodQuery(batchesSchema)
  batches(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(batchesSchema)) q: z.infer<typeof batchesSchema>) {
    return this.reports.batches(auth, q.itemId, q.warehouseId);
  }

  @Get('batches/expiring')
  @RequirePermissions('inventory.stock.read')
  @ApiZodQuery(expiringSchema)
  expiring(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(expiringSchema)) q: z.infer<typeof expiringSchema>) {
    return this.reports.expiring(auth, q.days, q.warehouseId);
  }

  @Get('valuation')
  @RequirePermissions('inventory.stock.read')
  valuation(@Auth() auth: AuthContext) {
    return this.reports.valuation(auth);
  }
}
