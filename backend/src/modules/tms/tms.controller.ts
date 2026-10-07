import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Auth, Public, RequirePermissions } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import {
  billSchema,
  completeSchema,
  contractSchema,
  decideBillSchema,
  dispatchSchema,
  expenseSchema,
  failSchema,
  podSchema,
  positionSchema,
  TmsService,
  transporterSchema,
  tripSchema,
  vehicleSchema,
} from './tms.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const stopPipe = new ZodValidationPipe(z.object({ id: z.uuid(), stopId: z.uuid() }));
const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const S = 'tms.setup.manage';
const T = 'tms.trips.manage';
const F = 'tms.freight.manage';
const R = 'sales.deliveries.read';

@ApiTags('Transport')
@ApiBearerAuth()
@Controller('tms')
export class TmsController {
  constructor(private readonly tms: TmsService) {}

  @Get('transporters')
  @RequirePermissions(R)
  transporters(@Auth() auth: AuthContext) {
    return this.tms.transporters(auth);
  }

  @Post('transporters')
  @RequirePermissions(S)
  createTransporter(@Auth() auth: AuthContext, @Body(body(transporterSchema)) b: z.infer<typeof transporterSchema>) {
    return this.tms.saveTransporter(auth, null, b);
  }

  @Put('transporters/:id')
  @RequirePermissions(S)
  updateTransporter(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(transporterSchema)) b: z.infer<typeof transporterSchema>) {
    return this.tms.saveTransporter(auth, p.id, b);
  }

  @Get('vehicles')
  @RequirePermissions(R)
  vehicles(@Auth() auth: AuthContext) {
    return this.tms.vehicles(auth);
  }

  @Post('vehicles')
  @RequirePermissions(S)
  createVehicle(@Auth() auth: AuthContext, @Body(body(vehicleSchema)) b: z.infer<typeof vehicleSchema>) {
    return this.tms.saveVehicle(auth, null, b);
  }

  @Put('vehicles/:id')
  @RequirePermissions(S)
  updateVehicle(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(vehicleSchema)) b: z.infer<typeof vehicleSchema>) {
    return this.tms.saveVehicle(auth, p.id, b);
  }

  @Get('contracts')
  @RequirePermissions(R)
  contracts(@Auth() auth: AuthContext) {
    return this.tms.contracts(auth);
  }

  @Get('contracts/:id')
  @RequirePermissions(R)
  contract(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.tms.contract(auth, p.id);
  }

  @Post('contracts')
  @RequirePermissions(S)
  createContract(@Auth() auth: AuthContext, @Body(body(contractSchema)) b: z.infer<typeof contractSchema>) {
    return this.tms.createContract(auth, b);
  }

  @Get('unplanned')
  @RequirePermissions(R)
  unplanned(@Auth() auth: AuthContext, @Query(body(z.object({ warehouseId: z.uuid().optional() }))) q: { warehouseId?: string }) {
    return this.tms.unplanned(auth, q.warehouseId);
  }

  @Get('trips')
  @RequirePermissions(R)
  trips(@Auth() auth: AuthContext, @Query(body(z.object({ from: z.iso.date().optional(), to: z.iso.date().optional(), status: z.string().max(20).optional() }))) q: { from?: string; to?: string; status?: string }) {
    return this.tms.trips(auth, q);
  }

  @Post('trips')
  @RequirePermissions(T)
  createTrip(@Auth() auth: AuthContext, @Body(body(tripSchema)) b: z.infer<typeof tripSchema>) {
    return this.tms.createTrip(auth, b);
  }

  @Get('trips/:id')
  @RequirePermissions(R)
  trip(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.tms.trip(auth, p.id);
  }

  @Post('trips/:id/dispatch')
  @HttpCode(200)
  @RequirePermissions(T)
  dispatch(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(dispatchSchema)) b: z.infer<typeof dispatchSchema>) {
    return this.tms.dispatch(auth, p.id, b);
  }

  @Post('trips/:id/relink')
  @HttpCode(200)
  @RequirePermissions(T)
  relink(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.tms.relink(auth, p.id);
  }

  @Post('trips/:id/expenses')
  @HttpCode(200)
  @RequirePermissions(T)
  expense(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(expenseSchema)) b: z.infer<typeof expenseSchema>) {
    return this.tms.addExpense(auth, p.id, b);
  }

  @Post('trips/:id/complete')
  @HttpCode(200)
  @RequirePermissions(T)
  complete(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(completeSchema)) b: z.infer<typeof completeSchema>) {
    return this.tms.complete(auth, p.id, b);
  }

  @Post('trips/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(T)
  cancel(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.tms.cancel(auth, p.id);
  }

  @Post('trips/:id/positions')
  @HttpCode(200)
  @RequirePermissions(T)
  position(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(positionSchema)) b: z.infer<typeof positionSchema>) {
    return this.tms.position(auth, p.id, b);
  }

  @Post('trips/:id/stops/:stopId/arrive')
  @HttpCode(200)
  @RequirePermissions(T)
  arrive(@Auth() auth: AuthContext, @Param(stopPipe) p: { id: string; stopId: string }) {
    return this.tms.arrive(auth, p.id, p.stopId);
  }

  @Post('trips/:id/stops/:stopId/pod')
  @HttpCode(200)
  @RequirePermissions(T)
  pod(@Auth() auth: AuthContext, @Param(stopPipe) p: { id: string; stopId: string }, @Body(body(podSchema)) b: z.infer<typeof podSchema>) {
    return this.tms.pod(auth, p.id, p.stopId, b);
  }

  @Post('trips/:id/stops/:stopId/fail')
  @HttpCode(200)
  @RequirePermissions(T)
  fail(@Auth() auth: AuthContext, @Param(stopPipe) p: { id: string; stopId: string }, @Body(body(failSchema)) b: z.infer<typeof failSchema>) {
    return this.tms.fail(auth, p.id, p.stopId, b);
  }

  @Get('transporters/:id/billable')
  @RequirePermissions(F)
  billable(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.tms.billable(auth, p.id);
  }

  @Get('freight-bills')
  @RequirePermissions(F)
  bills(@Auth() auth: AuthContext, @Query(body(z.object({ status: z.enum(['pending', 'approved', 'disputed']).optional() }))) q: { status?: string }) {
    return this.tms.bills(auth, q.status);
  }

  @Post('freight-bills')
  @RequirePermissions(F)
  createBill(@Auth() auth: AuthContext, @Body(body(billSchema)) b: z.infer<typeof billSchema>) {
    return this.tms.createBill(auth, b);
  }

  @Post('freight-bills/:id/decide')
  @HttpCode(200)
  @RequirePermissions(F)
  decide(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(decideBillSchema)) b: z.infer<typeof decideBillSchema>) {
    return this.tms.decideBill(auth, p.id, b);
  }
}

const tokenPipe = new ZodValidationPipe(z.object({ token: z.string().min(40).max(200) }));
const tokenStopPipe = new ZodValidationPipe(z.object({ token: z.string().min(40).max(200), stopId: z.uuid() }));

/** The driver's trip link: no login, the link itself is the key (and stops working when the trip ends). */
@ApiTags('Transport')
@Public()
@Controller('public/trips')
export class TmsDriverController {
  constructor(private readonly tms: TmsService) {}

  @Get(':token')
  view(@Param(tokenPipe) p: { token: string }) {
    return this.tms.driverView(p.token);
  }

  @Post(':token/positions')
  @HttpCode(200)
  position(@Param(tokenPipe) p: { token: string }, @Body(body(positionSchema)) b: z.infer<typeof positionSchema>) {
    return this.tms.driverPosition(p.token, b);
  }

  @Post(':token/stops/:stopId/arrive')
  @HttpCode(200)
  arrive(@Param(tokenStopPipe) p: { token: string; stopId: string }) {
    return this.tms.driverArrive(p.token, p.stopId);
  }

  @Post(':token/stops/:stopId/pod')
  @HttpCode(200)
  pod(@Param(tokenStopPipe) p: { token: string; stopId: string }, @Body(body(podSchema)) b: z.infer<typeof podSchema>) {
    return this.tms.driverPod(p.token, p.stopId, b);
  }

  @Post(':token/stops/:stopId/fail')
  @HttpCode(200)
  fail(@Param(tokenStopPipe) p: { token: string; stopId: string }, @Body(body(failSchema)) b: z.infer<typeof failSchema>) {
    return this.tms.driverFail(p.token, p.stopId, b);
  }
}
