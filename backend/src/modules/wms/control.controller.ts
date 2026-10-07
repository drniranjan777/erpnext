import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import {
  adhocCountSchema,
  consignmentSchema,
  countLineSchema,
  countSettingsSchema,
  cycleSchema,
  dipSchema,
  foundSchema,
  pickFaceSchema,
  reelEventSchema,
  reelSchema,
  returnableMoveSchema,
  returnableTypeSchema,
  tankSchema,
  WmsControlService,
} from './control.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const R = 'inventory.stock.read';
const S = 'wms.setup.manage';
const X = 'wms.tasks.execute';
const ADJ = 'inventory.entries.manage';

@ApiTags('Warehouse management')
@ApiBearerAuth()
@Controller('wms')
export class WmsControlController {
  constructor(private readonly c: WmsControlService) {}

  // ---- ABC and counts ----

  @Get('abc')
  @RequirePermissions(R)
  abcPreview(@Auth() auth: AuthContext) {
    return this.c.abc(auth, false);
  }

  @Post('abc')
  @HttpCode(200)
  @RequirePermissions(S)
  abcApply(@Auth() auth: AuthContext) {
    return this.c.abc(auth, true);
  }

  @Get('count-settings')
  @RequirePermissions(R)
  countSettings(@Auth() auth: AuthContext) {
    return this.c.countSettings(auth);
  }

  @Put('count-settings')
  @RequirePermissions(S)
  saveCountSettings(@Auth() auth: AuthContext, @Body(body(countSettingsSchema)) b: z.infer<typeof countSettingsSchema>) {
    return this.c.saveCountSettings(auth, b);
  }

  @Get('warehouses/:id/count-due')
  @RequirePermissions(R)
  due(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.c.dueBins(auth, p.id);
  }

  @Get('warehouses/:id/counts')
  @RequirePermissions(R)
  counts(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.c.counts(auth, p.id);
  }

  @Post('counts/cycle')
  @RequirePermissions(X)
  cycle(@Auth() auth: AuthContext, @Body(body(cycleSchema)) b: z.infer<typeof cycleSchema>) {
    return this.c.planCycle(auth, b);
  }

  @Post('counts/adhoc')
  @RequirePermissions(X)
  adhoc(@Auth() auth: AuthContext, @Body(body(adhocCountSchema)) b: z.infer<typeof adhocCountSchema>) {
    return this.c.adhoc(auth, b);
  }

  @Get('counts/:id')
  @RequirePermissions(R)
  count(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.c.count(auth, p.id);
  }

  @Post('counts/:id/lines/:lineId')
  @HttpCode(200)
  @RequirePermissions(X)
  record(@Auth() auth: AuthContext, @Param(body(z.object({ id: z.uuid(), lineId: z.uuid() }))) p: { id: string; lineId: string }, @Body(body(countLineSchema)) b: z.infer<typeof countLineSchema>) {
    return this.c.record(auth, p.id, p.lineId, b);
  }

  @Post('counts/:id/found')
  @RequirePermissions(X)
  found(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(foundSchema)) b: z.infer<typeof foundSchema>) {
    return this.c.found(auth, p.id, b);
  }

  @Post('counts/:id/post')
  @HttpCode(200)
  @RequirePermissions(X, ADJ)
  post(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.c.post(auth, p.id, requestMeta(req));
  }

  @Post('counts/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(X)
  cancelCount(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.c.cancelCount(auth, p.id);
  }

  // ---- replenishment and slotting ----

  @Put('bins/:id/pick-face')
  @RequirePermissions(S)
  pickFace(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(pickFaceSchema)) b: z.infer<typeof pickFaceSchema>) {
    return this.c.setPickFace(auth, p.id, b);
  }

  @Post('warehouses/:id/replenish')
  @HttpCode(200)
  @RequirePermissions(X)
  replenish(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.c.planReplenishment(auth, p.id);
  }

  @Get('warehouses/:id/slotting')
  @RequirePermissions(R)
  slotting(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.c.slotting(auth, p.id);
  }

  // ---- tanks ----

  @Get('warehouses/:id/tanks')
  @RequirePermissions(R)
  tanks(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.c.tanks(auth, p.id);
  }

  @Post('tanks')
  @RequirePermissions(S)
  saveTank(@Auth() auth: AuthContext, @Body(body(tankSchema)) b: z.infer<typeof tankSchema>) {
    return this.c.saveTank(auth, b);
  }

  @Get('tanks/:id/dips')
  @RequirePermissions(R)
  dips(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.c.dips(auth, p.id);
  }

  @Post('tanks/:id/dips')
  @RequirePermissions(X)
  dip(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(dipSchema)) b: z.infer<typeof dipSchema>, @Req() req: AppRequest) {
    return this.c.dip(auth, p.id, { ...b, adjust: false }, requestMeta(req));
  }

  /** A dip that also posts the variance as a stock adjustment to the tank's bin. */
  @Post('tanks/:id/dips/adjust')
  @RequirePermissions(X, ADJ)
  dipAndAdjust(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(dipSchema)) b: z.infer<typeof dipSchema>, @Req() req: AppRequest) {
    return this.c.dip(auth, p.id, { ...b, adjust: true }, requestMeta(req));
  }

  // ---- returnables ----

  @Get('returnables/types')
  @RequirePermissions(R)
  returnableTypes(@Auth() auth: AuthContext) {
    return this.c.returnableTypes(auth);
  }

  @Post('returnables/types')
  @RequirePermissions(S)
  createType(@Auth() auth: AuthContext, @Body(body(returnableTypeSchema)) b: z.infer<typeof returnableTypeSchema>) {
    return this.c.saveReturnableType(auth, null, b);
  }

  @Put('returnables/types/:id')
  @RequirePermissions(S)
  updateType(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(returnableTypeSchema)) b: z.infer<typeof returnableTypeSchema>) {
    return this.c.saveReturnableType(auth, p.id, b);
  }

  @Post('returnables/moves')
  @RequirePermissions(X)
  moveReturnable(@Auth() auth: AuthContext, @Body(body(returnableMoveSchema)) b: z.infer<typeof returnableMoveSchema>) {
    return this.c.moveReturnable(auth, b);
  }

  @Get('returnables/balances')
  @RequirePermissions(R)
  balances(@Auth() auth: AuthContext, @Query(body(z.object({ partyId: z.uuid().optional() }))) q: { partyId?: string }) {
    return this.c.returnableBalances(auth, q.partyId);
  }

  @Get('returnables/parties/:id')
  @RequirePermissions(R)
  partyMoves(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.c.returnableMoves(auth, p.id);
  }

  // ---- reels ----

  @Get('reels')
  @RequirePermissions(R)
  reels(@Auth() auth: AuthContext, @Query(body(z.object({ itemId: z.uuid().optional(), status: z.enum(['sealed', 'open', 'expired', 'empty']).optional() }))) q: { itemId?: string; status?: string }) {
    return this.c.reels(auth, q);
  }

  @Post('reels')
  @RequirePermissions(X)
  createReel(@Auth() auth: AuthContext, @Body(body(reelSchema)) b: z.infer<typeof reelSchema>) {
    return this.c.createReel(auth, b);
  }

  @Post('reels/:id/events')
  @HttpCode(200)
  @RequirePermissions(X)
  reelEvent(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(reelEventSchema)) b: z.infer<typeof reelEventSchema>) {
    return this.c.reelEvent(auth, p.id, b);
  }

  // ---- consignment ----

  @Get('consignments')
  @RequirePermissions(R)
  consignments(@Auth() auth: AuthContext) {
    return this.c.consignments(auth);
  }

  @Post('consignments')
  @RequirePermissions(S)
  createConsignment(@Auth() auth: AuthContext, @Body(body(consignmentSchema)) b: z.infer<typeof consignmentSchema>) {
    return this.c.saveConsignment(auth, b);
  }

  @Get('consignments/:id/statement')
  @RequirePermissions(R)
  statement(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(body(z.object({ from: z.iso.date(), to: z.iso.date() }))) q: { from: string; to: string }) {
    return this.c.consignmentStatement(auth, p.id, q.from, q.to);
  }
}
