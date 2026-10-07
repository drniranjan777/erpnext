import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import {
  appointmentSchema,
  appointmentStatusSchema,
  closePackageSchema,
  doorSchema,
  loadSchema,
  packageSchema,
  packItemSchema,
  pickSchema,
  receivingSchema,
  settingsSchema,
  waveSchema,
  WmsFlowService,
} from './flow.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const R = 'inventory.stock.read';
const S = 'wms.setup.manage';
const X = 'wms.tasks.execute';

@ApiTags('Warehouse management')
@ApiBearerAuth()
@Controller('wms')
export class WmsFlowController {
  constructor(private readonly flow: WmsFlowService) {}

  @Get('settings')
  @RequirePermissions(R)
  settings(@Auth() auth: AuthContext) {
    return this.flow.settings(auth);
  }

  @Put('settings')
  @RequirePermissions(S)
  saveSettings(@Auth() auth: AuthContext, @Body(body(settingsSchema)) b: z.infer<typeof settingsSchema>) {
    return this.flow.saveSettings(auth, b);
  }

  @Get('warehouses/:id/resolve')
  @RequirePermissions(R)
  resolve(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(body(z.object({ code: z.string().trim().min(1).max(80) }))) q: { code: string }) {
    return this.flow.resolve(auth, p.id, q.code);
  }

  // ---- docks ----

  @Get('warehouses/:id/doors')
  @RequirePermissions(R)
  doors(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.flow.doors(auth, p.id);
  }

  @Post('doors')
  @RequirePermissions(S)
  createDoor(@Auth() auth: AuthContext, @Body(body(doorSchema)) b: z.infer<typeof doorSchema>) {
    return this.flow.saveDoor(auth, null, b);
  }

  @Put('doors/:id')
  @RequirePermissions(S)
  updateDoor(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(doorSchema)) b: z.infer<typeof doorSchema>) {
    return this.flow.saveDoor(auth, p.id, b);
  }

  @Get('warehouses/:id/appointments')
  @RequirePermissions(R)
  appointments(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(body(z.object({ date: z.iso.date() }))) q: { date: string }) {
    return this.flow.appointments(auth, p.id, q.date);
  }

  @Post('appointments')
  @RequirePermissions(X)
  book(@Auth() auth: AuthContext, @Body(body(appointmentSchema)) b: z.infer<typeof appointmentSchema>) {
    return this.flow.book(auth, b);
  }

  @Post('appointments/:id/status')
  @HttpCode(200)
  @RequirePermissions(X)
  status(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(appointmentStatusSchema)) b: z.infer<typeof appointmentStatusSchema>) {
    return this.flow.setAppointment(auth, p.id, b.status);
  }

  // ---- inbound ----

  @Post('receiving')
  @RequirePermissions(X, 'purchase.receipts.manage')
  receive(@Auth() auth: AuthContext, @Body(body(receivingSchema)) b: z.infer<typeof receivingSchema>, @Req() req: AppRequest) {
    return this.flow.receive(auth, b, requestMeta(req));
  }

  // ---- outbound ----

  @Get('warehouses/:id/pickable')
  @RequirePermissions(R)
  pickable(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.flow.pickable(auth, p.id);
  }

  @Get('warehouses/:id/waves')
  @RequirePermissions(R)
  waves(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(body(z.object({ status: z.string().max(20).optional() }))) q: { status?: string }) {
    return this.flow.waves(auth, p.id, q.status);
  }

  @Post('waves')
  @RequirePermissions(X)
  createWave(@Auth() auth: AuthContext, @Body(body(waveSchema)) b: z.infer<typeof waveSchema>) {
    return this.flow.createWave(auth, b);
  }

  @Get('waves/:id')
  @RequirePermissions(R)
  wave(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.flow.wave(auth, p.id);
  }

  @Post('waves/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(X)
  cancelWave(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.flow.cancelWave(auth, p.id);
  }

  @Post('waves/:id/assign')
  @HttpCode(200)
  @RequirePermissions(X)
  assign(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(z.object({ userId: z.uuid().nullable(), zone: z.string().max(20).optional() }))) b: { userId: string | null; zone?: string }) {
    return this.flow.assign(auth, p.id, b.userId, b.zone);
  }

  @Post('picks/:id/confirm')
  @HttpCode(200)
  @RequirePermissions(X)
  pick(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(pickSchema)) b: z.infer<typeof pickSchema>) {
    return this.flow.confirmPick(auth, p.id, b);
  }

  @Post('waves/:id/deliveries')
  @RequirePermissions(X, 'sales.deliveries.manage')
  deliver(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.flow.deliverWave(auth, p.id, requestMeta(req));
  }

  @Get('orders/:id/packing')
  @RequirePermissions(R)
  packing(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.flow.packing(auth, p.id);
  }

  @Post('packages')
  @RequirePermissions(X)
  openPackage(@Auth() auth: AuthContext, @Body(body(packageSchema)) b: z.infer<typeof packageSchema>) {
    return this.flow.openPackage(auth, b);
  }

  @Post('packages/:id/items')
  @HttpCode(200)
  @RequirePermissions(X)
  packItem(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(packItemSchema)) b: z.infer<typeof packItemSchema>) {
    return this.flow.packItem(auth, p.id, b);
  }

  @Post('packages/:id/close')
  @HttpCode(200)
  @RequirePermissions(X)
  closePackage(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(closePackageSchema)) b: z.infer<typeof closePackageSchema>) {
    return this.flow.closePackage(auth, p.id, b);
  }

  @Get('packages/:id/label')
  @RequirePermissions(R)
  label(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.flow.label(auth, p.id);
  }

  @Get('deliveries/:id/loading')
  @RequirePermissions(R)
  loading(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.flow.loading(auth, p.id);
  }

  @Post('loading')
  @HttpCode(200)
  @RequirePermissions(X)
  load(@Auth() auth: AuthContext, @Body(body(loadSchema)) b: z.infer<typeof loadSchema>) {
    return this.flow.load(auth, b);
  }
}
