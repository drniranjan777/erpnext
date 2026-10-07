import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, Public, RequirePermissions } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { gatewaySchema, ingestSchema, IotService, ruleSchema, signalSchema } from './iot.service';

const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const M = 'iot.devices.manage';
const R = 'iot.data.read';

@ApiTags('IoT')
@ApiBearerAuth()
@Controller('iot')
export class IotController {
  constructor(private readonly iot: IotService) {}

  @Get('gateways')
  @RequirePermissions(R)
  gateways(@Auth() auth: AuthContext) {
    return this.iot.gateways(auth);
  }

  @Post('gateways')
  @RequirePermissions(M)
  @ApiZodBody(gatewaySchema)
  createGateway(@Auth() auth: AuthContext, @Body(body(gatewaySchema)) b: z.infer<typeof gatewaySchema>) {
    return this.iot.createGateway(auth, b);
  }

  @Post('gateways/:id/token')
  @RequirePermissions(M)
  rotate(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.iot.rotateToken(auth, p.id);
  }

  @Post('gateways/:id/status')
  @HttpCode(200)
  @RequirePermissions(M)
  status(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(z.object({ status: z.enum(['active', 'disabled']) }))) b: { status: 'active' | 'disabled' }) {
    return this.iot.setGatewayStatus(auth, p.id, b.status);
  }

  @Get('signals')
  @RequirePermissions(R)
  signals(@Auth() auth: AuthContext, @Query(body(z.object({ machineId: z.uuid().optional(), gatewayId: z.uuid().optional() }))) q: { machineId?: string; gatewayId?: string }) {
    return this.iot.signals(auth, q);
  }

  @Post('signals')
  @RequirePermissions(M)
  @ApiZodBody(signalSchema)
  createSignal(@Auth() auth: AuthContext, @Body(body(signalSchema)) b: z.infer<typeof signalSchema>) {
    return this.iot.saveSignal(auth, null, b);
  }

  @Put('signals/:id')
  @RequirePermissions(M)
  @ApiZodBody(signalSchema)
  updateSignal(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(signalSchema)) b: z.infer<typeof signalSchema>) {
    return this.iot.saveSignal(auth, p.id, b);
  }

  @Get('signals/:id/series')
  @RequirePermissions(R)
  series(
    @Auth() auth: AuthContext,
    @Param(idPipe) p: { id: string },
    @Query(body(z.object({ from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(), points: z.coerce.number().int().min(10).max(2000).default(240) }))) q: { from?: string; to?: string; points: number },
  ) {
    return this.iot.series(auth, p.id, q);
  }

  @Get('rules')
  @RequirePermissions(R)
  rules(@Auth() auth: AuthContext, @Query(body(z.object({ signalId: z.uuid().optional() }))) q: { signalId?: string }) {
    return this.iot.rules(auth, q.signalId);
  }

  @Post('rules')
  @RequirePermissions(M)
  @ApiZodBody(ruleSchema)
  createRule(@Auth() auth: AuthContext, @Body(body(ruleSchema)) b: z.infer<typeof ruleSchema>) {
    return this.iot.saveRule(auth, null, b);
  }

  @Put('rules/:id')
  @RequirePermissions(M)
  @ApiZodBody(ruleSchema)
  updateRule(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(ruleSchema)) b: z.infer<typeof ruleSchema>) {
    return this.iot.saveRule(auth, p.id, b);
  }

  @Get('alarms')
  @RequirePermissions(R)
  alarms(@Auth() auth: AuthContext, @Query(body(z.object({ status: z.enum(['open', 'all']).default('open'), limit: z.coerce.number().int().min(1).max(500).default(100) }))) q: { status: 'open' | 'all'; limit: number }) {
    return this.iot.alarms(auth, q);
  }

  @Post('alarms/:id/ack')
  @HttpCode(200)
  @RequirePermissions(R)
  ack(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(z.object({ note: z.string().trim().max(500).nullable().optional() }))) b: { note?: string | null }) {
    return this.iot.ack(auth, p.id, b.note);
  }
}

/** Called by edge gateways with their device token (x-device-token). */
@ApiTags('IoT devices')
@Public()
@Controller('iot/device')
export class IotDeviceController {
  constructor(private readonly iot: IotService) {}

  @Get('config')
  config(@Headers('x-device-token') token: string | undefined) {
    return this.iot.agentConfig(token);
  }

  @Post('ingest')
  @HttpCode(200)
  @ApiZodBody(ingestSchema)
  ingest(@Headers('x-device-token') token: string | undefined, @Body(body(ingestSchema)) b: z.infer<typeof ingestSchema>, @Req() req: AppRequest) {
    return this.iot.ingest(token, b, req.ip ?? null);
  }
}
