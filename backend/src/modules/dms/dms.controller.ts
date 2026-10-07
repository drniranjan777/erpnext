import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { todayIST } from '../../common/fiscal-year';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { beatSchema, checkInSchema, checkOutSchema, claimSchema, decideClaimSchema, distributorSchema, DmsService, previewSchema, redeemSchema, retailerSchema, schemeSchema, secondarySchema, stockAdjustSchema } from './dms.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const R = 'dms.network.read';
const W = 'dms.network.manage';
const lines = z.object({ lines: z.array(z.object({ itemId: z.uuid(), qty: z.number().positive().max(1e8), rate: z.number().min(0).max(1e9).optional() })).min(1).max(200) });

@ApiTags('Distribution')
@ApiBearerAuth()
@Controller('dms')
export class DmsController {
  constructor(private readonly dms: DmsService) {}

  @Get('distributors')
  @RequirePermissions(R)
  distributors(@Auth() auth: AuthContext) {
    return this.dms.distributors(auth);
  }
  @Post('distributors')
  @RequirePermissions(W)
  addDistributor(@Auth() auth: AuthContext, @Body(body(distributorSchema)) b: z.infer<typeof distributorSchema>) {
    return this.dms.saveDistributor(auth, null, b);
  }
  @Put('distributors/:id')
  @RequirePermissions(W)
  updateDistributor(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(distributorSchema)) b: z.infer<typeof distributorSchema>) {
    return this.dms.saveDistributor(auth, p.id, b);
  }
  @Get('distributors/:id/stock')
  @RequirePermissions(R)
  stock(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(body(z.object({ asOf: z.iso.date().optional() }))) q: { asOf?: string }) {
    return this.dms.stock(auth, p.id, q.asOf);
  }
  @Post('stock-adjustments')
  @RequirePermissions(W)
  adjust(@Auth() auth: AuthContext, @Body(body(stockAdjustSchema)) b: z.infer<typeof stockAdjustSchema>) {
    return this.dms.adjustStock(auth, b);
  }
  @Get('beats')
  @RequirePermissions(R)
  beats(@Auth() auth: AuthContext) {
    return this.dms.beats(auth);
  }
  @Post('beats')
  @RequirePermissions(W)
  addBeat(@Auth() auth: AuthContext, @Body(body(beatSchema)) b: z.infer<typeof beatSchema>) {
    return this.dms.saveBeat(auth, null, b);
  }
  @Put('beats/:id')
  @RequirePermissions(W)
  updateBeat(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(beatSchema)) b: z.infer<typeof beatSchema>) {
    return this.dms.saveBeat(auth, p.id, b);
  }
  @Get('retailers')
  @RequirePermissions(R)
  retailers(@Auth() auth: AuthContext, @Query(body(z.object({ distributorId: z.uuid().optional(), beatId: z.uuid().optional(), q: z.string().trim().max(60).optional() }))) q: { distributorId?: string; beatId?: string; q?: string }) {
    return this.dms.retailers(auth, q);
  }
  @Post('retailers')
  @RequirePermissions(W)
  @ApiZodBody(retailerSchema)
  addRetailer(@Auth() auth: AuthContext, @Body(body(retailerSchema)) b: z.infer<typeof retailerSchema>) {
    return this.dms.saveRetailer(auth, null, b);
  }
  @Put('retailers/:id')
  @RequirePermissions(W)
  @ApiZodBody(retailerSchema)
  updateRetailer(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(retailerSchema)) b: z.infer<typeof retailerSchema>) {
    return this.dms.saveRetailer(auth, p.id, b);
  }
  @Get('retailers/:id/loyalty')
  @RequirePermissions(R)
  loyalty(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.dms.loyalty(auth, p.id);
  }
  @Post('retailers/:id/redeem')
  @RequirePermissions(W)
  redeem(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(redeemSchema)) b: z.infer<typeof redeemSchema>) {
    return this.dms.redeem(auth, p.id, b);
  }

  // ---- schemes and sales ------------------------------------------------------------------
  @Get('schemes')
  @RequirePermissions(R)
  schemes(@Auth() auth: AuthContext) {
    return this.dms.schemes(auth);
  }
  @Post('schemes')
  @RequirePermissions('dms.schemes.manage')
  @ApiZodBody(schemeSchema)
  addScheme(@Auth() auth: AuthContext, @Body(body(schemeSchema)) b: z.infer<typeof schemeSchema>) {
    return this.dms.saveScheme(auth, null, b);
  }
  @Put('schemes/:id')
  @RequirePermissions('dms.schemes.manage')
  @ApiZodBody(schemeSchema)
  updateScheme(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(schemeSchema)) b: z.infer<typeof schemeSchema>) {
    return this.dms.saveScheme(auth, p.id, b);
  }
  @Post('price')
  @HttpCode(200)
  @RequirePermissions(R)
  price(@Auth() auth: AuthContext, @Body(body(previewSchema)) b: z.infer<typeof previewSchema>) {
    return this.dms.preview(auth, b);
  }
  @Get('secondary-sales')
  @RequirePermissions(R)
  sales(@Auth() auth: AuthContext, @Query(body(z.object({ distributorId: z.uuid().optional(), retailerId: z.uuid().optional(), from: z.iso.date().optional(), to: z.iso.date().optional() }))) q: { distributorId?: string; retailerId?: string; from?: string; to?: string }) {
    return this.dms.secondarySales(auth, q);
  }
  @Post('secondary-sales')
  @RequirePermissions(W)
  @ApiZodBody(secondarySchema)
  record(@Auth() auth: AuthContext, @Body(body(secondarySchema)) b: z.infer<typeof secondarySchema>) {
    return this.dms.recordSale(auth, b);
  }
  @Post('secondary-sales/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(W)
  cancel(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.dms.cancelSale(auth, p.id);
  }
  /** multipart/form-data: retailer_code, item_code, qty, rate, date, invoice_no */
  @Post('secondary-sales/import')
  @HttpCode(200)
  @RequirePermissions(W)
  @ApiConsumes('multipart/form-data')
  async importSales(@Auth() auth: AuthContext, @Req() req: AppRequest) {
    if (!req.isMultipart()) throw new BadRequestException('Send the file as multipart/form-data');
    const file = await req.file();
    if (!file) throw new BadRequestException('No file received');
    return this.dms.importSales(auth, await file.toBuffer(), file.filename);
  }

  // ---- field force ------------------------------------------------------------------------
  @Get('field/day')
  @RequirePermissions('dms.field.use')
  myDay(@Auth() auth: AuthContext, @Query(body(z.object({ date: z.iso.date().optional() }))) q: { date?: string }) {
    return this.dms.myDay(auth, q.date);
  }
  /** multipart/form-data: retailerId, latitude, longitude, then an optional photo. Or JSON without a photo. */
  @Post('field/visits')
  @RequirePermissions('dms.field.use')
  async checkIn(@Auth() auth: AuthContext, @Req() req: AppRequest) {
    if (!req.isMultipart()) {
      const parsed = checkInSchema.safeParse(req.body);
      if (!parsed.success) throw new BadRequestException('Give the retailer and your location');
      return this.dms.checkIn(auth, parsed.data, null);
    }
    const file = await req.file();
    if (!file) throw new BadRequestException('No photo received');
    const field = (name: string) => {
      const f = file.fields[name] as { value?: unknown } | undefined;
      return typeof f?.value === 'string' ? f.value : undefined;
    };
    const parsed = checkInSchema.safeParse({ retailerId: field('retailerId'), latitude: field('latitude'), longitude: field('longitude') });
    if (!parsed.success) {
      file.file.resume();
      throw new BadRequestException('Give the retailer and your location (allow location access)');
    }
    return this.dms.checkIn(auth, parsed.data, file);
  }
  @Post('field/visits/:id/order')
  @RequirePermissions('dms.field.use')
  order(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(lines)) b: z.infer<typeof lines>) {
    return this.dms.visitOrder(auth, p.id, b.lines);
  }
  @Post('field/visits/:id/check-out')
  @HttpCode(200)
  @RequirePermissions('dms.field.use')
  checkOut(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(checkOutSchema)) b: z.infer<typeof checkOutSchema>) {
    return this.dms.checkOut(auth, p.id, b);
  }
  @Get('visits/report')
  @RequirePermissions(R)
  visitReport(@Auth() auth: AuthContext, @Query(body(z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }))) q: { from?: string; to?: string }) {
    return this.dms.visitReport(auth, q.from ?? `${todayIST().slice(0, 7)}-01`, q.to ?? todayIST());
  }

  // ---- claims -----------------------------------------------------------------------------
  @Get('claims')
  @RequirePermissions(R)
  claims(@Auth() auth: AuthContext, @Query(body(z.object({ status: z.enum(['submitted', 'approved', 'rejected', 'settled']).optional(), distributorId: z.uuid().optional() }))) q: { status?: string; distributorId?: string }) {
    return this.dms.claims(auth, q);
  }
  @Post('claims')
  @RequirePermissions('dms.claims.manage')
  @ApiZodBody(claimSchema)
  raise(@Auth() auth: AuthContext, @Body(body(claimSchema)) b: z.infer<typeof claimSchema>) {
    return this.dms.raiseClaim(auth, b);
  }
  @Post('claims/:id/decide')
  @HttpCode(200)
  @RequirePermissions('dms.claims.manage')
  decide(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(decideClaimSchema)) b: z.infer<typeof decideClaimSchema>) {
    return this.dms.decideClaim(auth, p.id, b);
  }
  @Post('claims/:id/settle')
  @HttpCode(200)
  @RequirePermissions('dms.claims.settle')
  settle(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.dms.settleClaim(auth, p.id, requestMeta(req));
  }

  @Get('settings')
  @RequirePermissions(R)
  settings(@Auth() auth: AuthContext) {
    return this.dms.getSettings(auth);
  }
  @Put('settings')
  @RequirePermissions(W)
  saveSettings(@Auth() auth: AuthContext, @Body(body(z.object({ pointsPerHundred: z.number().min(0).max(100), visitRadiusMetres: z.number().int().min(20).max(5000) }))) b: { pointsPerHundred: number; visitRadiusMetres: number }) {
    return this.dms.saveSettings(auth, b);
  }
}
