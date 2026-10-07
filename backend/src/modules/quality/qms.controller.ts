import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { todayIST } from '../../common/fiscal-year';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { cancelSchema, versionSchema, type CancelInput } from '../documents/documents.schemas';
import { coaSchema, InspectionsService } from './inspections.service';
import { LOT_STATUSES, LotsService, lotStatusSchema, retainSchema, type LotStatusInput } from './lots.service';
import { createNcrSchema, NcrsService, updateNcrSchema, type CreateNcrInput } from './ncrs.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const versionQuery = new ZodValidationPipe(z.object({ version: z.coerce.number().int() }));
const lotsQuery = new ZodValidationPipe(z.object({ status: z.enum(LOT_STATUSES).optional(), itemId: z.uuid().optional(), q: z.string().trim().max(60).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }));
const ncrQuery = new ZodValidationPipe(
  z.object({
    status: z.string().optional(),
    source: z.string().max(20).optional(),
    itemId: z.uuid().optional(),
    partyId: z.uuid().optional(),
    q: z.string().trim().max(60).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.uuid().optional(),
  }),
);
const copqQuery = new ZodValidationPipe(z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }));

/** Lot release, retain samples, vendor CoA, non-conformance and cost of poor quality. */
@ApiTags('Quality')
@ApiBearerAuth()
@Controller('quality')
export class QmsController {
  constructor(
    private readonly lots: LotsService,
    private readonly ncrs: NcrsService,
    private readonly inspections: InspectionsService,
  ) {}

  // ---- lots -------------------------------------------------------------------------------
  @Get('lots')
  @RequirePermissions('quality.inspections.read')
  listLots(@Auth() auth: AuthContext, @Query(lotsQuery) q: { status?: string; itemId?: string; q?: string; limit: number; offset: number }) {
    return this.lots.list(auth, q);
  }
  @Post('lots/status')
  @HttpCode(200)
  @RequirePermissions('quality.release.sign')
  @ApiZodBody(lotStatusSchema)
  setLotStatus(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(lotStatusSchema)) b: LotStatusInput, @Req() req: AppRequest) {
    return this.lots.setStatus(auth, b, requestMeta(req));
  }
  @Get('signatures/:id')
  @RequirePermissions('quality.inspections.read')
  signatures(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.lots.signatures(auth, p.id);
  }

  // ---- retain samples ---------------------------------------------------------------------
  @Get('retain-samples')
  @RequirePermissions('quality.inspections.read')
  retains(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ itemId: z.uuid().optional(), due: z.enum(['true', 'false']).optional() }))) q: { itemId?: string; due?: string }) {
    return this.lots.retains(auth, q);
  }
  @Post('retain-samples')
  @RequirePermissions('quality.inspections.manage')
  @ApiZodBody(retainSchema)
  addRetain(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(retainSchema)) b: z.infer<typeof retainSchema>) {
    return this.lots.addRetain(auth, b);
  }
  @Post('retain-samples/:id/dispose')
  @HttpCode(200)
  @RequirePermissions('quality.inspections.manage')
  disposeRetain(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.lots.disposeRetain(auth, p.id);
  }

  // ---- vendor certificate of analysis --------------------------------------------------------
  @Put('inspections/:id/coa')
  @RequirePermissions('quality.inspections.manage')
  @ApiZodBody(coaSchema)
  coa(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(coaSchema)) b: z.infer<typeof coaSchema>) {
    return this.inspections.setCoa(auth, p.id, b);
  }

  // ---- non-conformance --------------------------------------------------------------------
  @Get('ncrs')
  @RequirePermissions('quality.inspections.read')
  listNcrs(@Auth() auth: AuthContext, @Query(ncrQuery) q: { status?: string; source?: string; itemId?: string; partyId?: string; q?: string; limit: number; cursor?: string }) {
    return this.ncrs.list(auth, q);
  }
  @Get('copq')
  @RequirePermissions('quality.inspections.read')
  copq(@Auth() auth: AuthContext, @Query(copqQuery) q: { from?: string; to?: string }) {
    const to = q.to ?? todayIST();
    return this.ncrs.copq(auth, { from: q.from ?? `${Number(to.slice(0, 4)) - (Number(to.slice(5, 7)) < 4 ? 1 : 0)}-04-01`, to });
  }
  @Get('ncrs/:id')
  @RequirePermissions('quality.inspections.read')
  getNcr(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.ncrs.get(auth, p.id);
  }
  @Post('ncrs')
  @RequirePermissions('quality.ncr.manage')
  @ApiZodBody(createNcrSchema)
  createNcr(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createNcrSchema)) b: CreateNcrInput, @Req() req: AppRequest) {
    return this.ncrs.create(auth, b, requestMeta(req));
  }
  @Post('ncrs/from-inspection/:id')
  @RequirePermissions('quality.ncr.manage')
  ncrFromInspection(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.ncrs.fromInspection(auth, p.id, requestMeta(req));
  }
  @Put('ncrs/:id')
  @RequirePermissions('quality.ncr.manage')
  @ApiZodBody(updateNcrSchema)
  updateNcr(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateNcrSchema)) b: z.infer<typeof updateNcrSchema>, @Req() req: AppRequest) {
    return this.ncrs.update(auth, p.id, b, requestMeta(req));
  }
  @Delete('ncrs/:id')
  @HttpCode(204)
  @RequirePermissions('quality.ncr.manage')
  removeNcr(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.ncrs.remove(auth, p.id, q.version, requestMeta(req));
  }
  @Post('ncrs/:id/submit')
  @HttpCode(200)
  @RequirePermissions('quality.ncr.manage')
  submitNcr(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(versionSchema)) b: { version: number }, @Req() req: AppRequest) {
    return this.ncrs.submit(auth, p.id, b.version, requestMeta(req));
  }
  @Post('ncrs/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('quality.ncr.manage')
  cancelNcr(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(cancelSchema)) b: CancelInput, @Req() req: AppRequest) {
    return this.ncrs.cancel(auth, p.id, b.version, b.reason, requestMeta(req));
  }
  @Post('ncrs/:id/close')
  @HttpCode(200)
  @RequirePermissions('quality.ncr.manage')
  closeNcr(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(versionSchema)) b: { version: number }, @Req() req: AppRequest) {
    return this.ncrs.close(auth, p.id, b.version, requestMeta(req));
  }
}
