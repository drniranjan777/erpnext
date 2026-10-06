import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, ApiZodQuery, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { cancelSchema, versionSchema, type CancelInput } from '../documents/documents.schemas';
import { DebitNotesService } from './debit-notes.service';
import {
  billableSchema,
  createDnSchema,
  createLcSchema,
  createPiSchema,
  listDnSchema,
  listLcSchema,
  listPiSchema,
  updateDnSchema,
  updateLcSchema,
  updatePiSchema,
  type CreateDnInput,
  type CreateLcInput,
  type CreatePiInput,
  type ListPiQuery,
} from './invoices.schemas';
import { InvoicesService } from './invoices.service';
import { LandedCostsService } from './landed-costs.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const versionPipe = new ZodValidationPipe(versionSchema);
const versionQuery = new ZodValidationPipe(z.object({ version: z.coerce.number().int() }));

@ApiTags('Purchase invoices')
@ApiBearerAuth()
@Controller('purchase')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly debitNotes: DebitNotesService,
    private readonly landedCosts: LandedCostsService,
  ) {}

  @Get('tds-sections')
  @RequirePermissions('purchase.invoices.read')
  tdsSections() {
    return this.invoices.tdsSections();
  }

  // ---- Purchase invoices ----

  @Get('invoices')
  @RequirePermissions('purchase.invoices.read')
  @ApiZodQuery(listPiSchema)
  list(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(listPiSchema)) q: ListPiQuery) {
    return this.invoices.list(auth, q);
  }

  @Get('invoices/billable')
  @RequirePermissions('purchase.invoices.manage')
  @ApiZodQuery(billableSchema)
  billable(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(billableSchema)) q: z.infer<typeof billableSchema>) {
    return this.invoices.billable(auth, q.vendorId, q.poId);
  }

  @Get('invoices/:id')
  @RequirePermissions('purchase.invoices.read')
  get(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.invoices.get(auth, p.id);
  }

  @Post('invoices')
  @RequirePermissions('purchase.invoices.manage')
  @ApiZodBody(createPiSchema)
  create(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createPiSchema)) body: CreatePiInput, @Req() req: AppRequest) {
    return this.invoices.create(auth, body, requestMeta(req));
  }

  @Put('invoices/:id')
  @RequirePermissions('purchase.invoices.manage')
  @ApiZodBody(updatePiSchema)
  update(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updatePiSchema)) body: z.infer<typeof updatePiSchema>, @Req() req: AppRequest) {
    return this.invoices.update(auth, p.id, body, requestMeta(req));
  }

  @Delete('invoices/:id')
  @HttpCode(204)
  @RequirePermissions('purchase.invoices.manage')
  remove(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.invoices.remove(auth, p.id, q.version, requestMeta(req));
  }

  @Post('invoices/:id/submit')
  @HttpCode(200)
  @RequirePermissions('purchase.invoices.manage')
  @ApiZodBody(versionSchema)
  submit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(versionPipe) body: { version: number }, @Req() req: AppRequest) {
    return this.invoices.submit(auth, p.id, body.version, requestMeta(req));
  }

  @Post('invoices/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('purchase.invoices.cancel')
  @ApiZodBody(cancelSchema)
  cancel(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(cancelSchema)) body: CancelInput, @Req() req: AppRequest) {
    return this.invoices.cancel(auth, p.id, body.version, body.reason, requestMeta(req));
  }

  // ---- Debit notes ----

  @Get('debit-notes')
  @RequirePermissions('purchase.invoices.read')
  @ApiZodQuery(listDnSchema)
  listDn(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(listDnSchema)) q: z.infer<typeof listDnSchema>) {
    return this.debitNotes.list(auth, q);
  }

  @Get('debit-notes/:id')
  @RequirePermissions('purchase.invoices.read')
  getDn(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.debitNotes.get(auth, p.id);
  }

  @Post('debit-notes')
  @RequirePermissions('purchase.invoices.manage')
  @ApiZodBody(createDnSchema)
  createDn(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createDnSchema)) body: CreateDnInput, @Req() req: AppRequest) {
    return this.debitNotes.create(auth, body, requestMeta(req));
  }

  @Put('debit-notes/:id')
  @RequirePermissions('purchase.invoices.manage')
  @ApiZodBody(updateDnSchema)
  updateDn(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateDnSchema)) body: z.infer<typeof updateDnSchema>, @Req() req: AppRequest) {
    return this.debitNotes.update(auth, p.id, body, requestMeta(req));
  }

  @Delete('debit-notes/:id')
  @HttpCode(204)
  @RequirePermissions('purchase.invoices.manage')
  removeDn(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.debitNotes.remove(auth, p.id, q.version, requestMeta(req));
  }

  @Post('debit-notes/:id/submit')
  @HttpCode(200)
  @RequirePermissions('purchase.invoices.manage')
  @ApiZodBody(versionSchema)
  submitDn(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(versionPipe) body: { version: number }, @Req() req: AppRequest) {
    return this.debitNotes.submit(auth, p.id, body.version, requestMeta(req));
  }

  @Post('debit-notes/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('purchase.invoices.cancel')
  @ApiZodBody(cancelSchema)
  cancelDn(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(cancelSchema)) body: CancelInput, @Req() req: AppRequest) {
    return this.debitNotes.cancel(auth, p.id, body.version, body.reason, requestMeta(req));
  }

  // ---- Landed costs ----

  @Get('landed-costs')
  @RequirePermissions('purchase.invoices.read')
  @ApiZodQuery(listLcSchema)
  listLc(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(listLcSchema)) q: z.infer<typeof listLcSchema>) {
    return this.landedCosts.list(auth, q);
  }

  @Get('landed-costs/:id')
  @RequirePermissions('purchase.invoices.read')
  getLc(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.landedCosts.get(auth, p.id);
  }

  @Post('landed-costs')
  @RequirePermissions('purchase.invoices.manage')
  @ApiZodBody(createLcSchema)
  createLc(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createLcSchema)) body: CreateLcInput, @Req() req: AppRequest) {
    return this.landedCosts.create(auth, body, requestMeta(req));
  }

  @Put('landed-costs/:id')
  @RequirePermissions('purchase.invoices.manage')
  @ApiZodBody(updateLcSchema)
  updateLc(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateLcSchema)) body: z.infer<typeof updateLcSchema>, @Req() req: AppRequest) {
    return this.landedCosts.update(auth, p.id, body, requestMeta(req));
  }

  @Delete('landed-costs/:id')
  @HttpCode(204)
  @RequirePermissions('purchase.invoices.manage')
  removeLc(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.landedCosts.remove(auth, p.id, q.version, requestMeta(req));
  }

  @Post('landed-costs/:id/submit')
  @HttpCode(200)
  @RequirePermissions('purchase.invoices.manage')
  @ApiZodBody(versionSchema)
  submitLc(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(versionPipe) body: { version: number }, @Req() req: AppRequest) {
    return this.landedCosts.submit(auth, p.id, body.version, requestMeta(req));
  }

  @Post('landed-costs/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('purchase.invoices.cancel')
  @ApiZodBody(cancelSchema)
  cancelLc(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(cancelSchema)) body: CancelInput, @Req() req: AppRequest) {
    return this.landedCosts.cancel(auth, p.id, body.version, body.reason, requestMeta(req));
  }
}
