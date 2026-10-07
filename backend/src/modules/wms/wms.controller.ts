import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Auth, RequirePermissions } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { binSchema, blockSchema, confirmSchema, generateSchema, moveSchema, profileSchema, WmsService, zoneSchema } from './wms.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const R = 'inventory.stock.read';
const S = 'wms.setup.manage';
const X = 'wms.tasks.execute';

@ApiTags('Warehouse management')
@ApiBearerAuth()
@Controller('wms')
export class WmsController {
  constructor(private readonly wms: WmsService) {}

  @Get('warehouses')
  @RequirePermissions(R)
  warehouses(@Auth() auth: AuthContext) {
    return this.wms.warehouses(auth);
  }

  @Post('warehouses/:id/enable')
  @HttpCode(200)
  @RequirePermissions(S)
  enable(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.wms.enable(auth, p.id);
  }

  @Get('warehouses/:id/zones')
  @RequirePermissions(R)
  zones(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.wms.zones(auth, p.id);
  }

  @Post('zones')
  @RequirePermissions(S)
  createZone(@Auth() auth: AuthContext, @Body(body(zoneSchema)) b: z.infer<typeof zoneSchema>) {
    return this.wms.saveZone(auth, null, b);
  }

  @Put('zones/:id')
  @RequirePermissions(S)
  updateZone(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(zoneSchema)) b: z.infer<typeof zoneSchema>) {
    return this.wms.saveZone(auth, p.id, b);
  }

  @Get('warehouses/:id/bins')
  @RequirePermissions(R)
  bins(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(body(z.object({ zoneId: z.uuid().optional(), q: z.string().max(30).optional() }))) q: { zoneId?: string; q?: string }) {
    return this.wms.bins(auth, p.id, q);
  }

  @Get('warehouses/:id/bins/:key')
  @RequirePermissions(R)
  bin(@Auth() auth: AuthContext, @Param(body(z.object({ id: z.uuid(), key: z.string().min(1).max(40) }))) p: { id: string; key: string }) {
    return this.wms.bin(auth, p.id, p.key);
  }

  @Post('bins')
  @RequirePermissions(S)
  createBin(@Auth() auth: AuthContext, @Body(body(binSchema)) b: z.infer<typeof binSchema>) {
    return this.wms.saveBin(auth, null, b);
  }

  @Put('bins/:id')
  @RequirePermissions(S)
  updateBin(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(binSchema)) b: z.infer<typeof binSchema>) {
    return this.wms.saveBin(auth, p.id, b);
  }

  @Post('bins/generate')
  @RequirePermissions(S)
  generate(@Auth() auth: AuthContext, @Body(body(generateSchema)) b: z.infer<typeof generateSchema>) {
    return this.wms.generateBins(auth, b);
  }

  @Post('bins/:id/block')
  @HttpCode(200)
  @RequirePermissions(X)
  block(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(blockSchema)) b: z.infer<typeof blockSchema>) {
    return this.wms.block(auth, p.id, b);
  }

  @Get('items/:id/profile')
  @RequirePermissions(R)
  profile(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.wms.profile(auth, p.id);
  }

  @Put('items/:id/profile')
  @RequirePermissions(S)
  saveProfile(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(profileSchema)) b: z.infer<typeof profileSchema>) {
    return this.wms.saveProfile(auth, p.id, b);
  }

  @Get('items/:id/locations')
  @RequirePermissions(R)
  locations(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(body(z.object({ warehouseId: z.uuid().optional() }))) q: { warehouseId?: string }) {
    return this.wms.locations(auth, p.id, q.warehouseId);
  }

  @Post('moves')
  @HttpCode(200)
  @RequirePermissions(X)
  move(@Auth() auth: AuthContext, @Body(body(moveSchema)) b: z.infer<typeof moveSchema>) {
    return this.wms.move(auth, b);
  }

  @Post('warehouses/:id/putaway')
  @HttpCode(200)
  @RequirePermissions(X)
  plan(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.wms.planPutaway(auth, p.id);
  }

  @Get('tasks')
  @RequirePermissions(R)
  tasks(
    @Auth() auth: AuthContext,
    @Query(body(z.object({ warehouseId: z.uuid().optional(), kind: z.string().max(20).optional(), status: z.enum(['open', 'done', 'cancelled']).optional(), mine: z.enum(['true', 'false']).optional() })))
    q: { warehouseId?: string; kind?: string; status?: string; mine?: string },
  ) {
    return this.wms.tasks(auth, { ...q, mine: q.mine === 'true' });
  }

  @Post('tasks/:id/confirm')
  @HttpCode(200)
  @RequirePermissions(X)
  confirm(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(confirmSchema)) b: z.infer<typeof confirmSchema>) {
    return this.wms.confirm(auth, p.id, b);
  }

  @Post('tasks/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(X)
  cancel(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.wms.cancelTask(auth, p.id);
  }

  @Get('warehouses/:id/heatmap')
  @RequirePermissions(R)
  heatmap(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.wms.heatmap(auth, p.id);
  }

  @Get('warehouses/:id/reconcile')
  @RequirePermissions(R)
  reconcile(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.wms.reconcile(auth, p.id);
  }
}
