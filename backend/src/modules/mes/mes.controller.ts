import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { andonSchema, explainSchema, MesService, oeeQuery, reasonSchema, settingsSchema, shiftsSchema, stateSchema } from './mes.service';

const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const R = 'mes.oee.read';
const U = 'mes.shopfloor.use';
const S = 'mes.setup.manage';

@ApiTags('MES')
@ApiBearerAuth()
@Controller('mes')
export class MesController {
  constructor(private readonly mes: MesService) {}

  @Get('setup')
  @RequirePermissions(R)
  setup(@Auth() auth: AuthContext) {
    return this.mes.setup(auth);
  }

  @Put('shifts')
  @RequirePermissions(S)
  @ApiZodBody(shiftsSchema)
  shifts(@Auth() auth: AuthContext, @Body(body(shiftsSchema)) b: z.infer<typeof shiftsSchema>) {
    return this.mes.saveShifts(auth, b);
  }

  @Post('reasons')
  @RequirePermissions(S)
  @ApiZodBody(reasonSchema)
  createReason(@Auth() auth: AuthContext, @Body(body(reasonSchema)) b: z.infer<typeof reasonSchema>) {
    return this.mes.saveReason(auth, null, b);
  }

  @Put('reasons/:id')
  @RequirePermissions(S)
  @ApiZodBody(reasonSchema)
  updateReason(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(reasonSchema)) b: z.infer<typeof reasonSchema>) {
    return this.mes.saveReason(auth, p.id, b);
  }

  @Put('machines/:id/settings')
  @RequirePermissions(S)
  @ApiZodBody(settingsSchema)
  settings(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(settingsSchema)) b: z.infer<typeof settingsSchema>) {
    return this.mes.saveSettings(auth, p.id, b);
  }

  @Get('board')
  @RequirePermissions(R)
  board(@Auth() auth: AuthContext) {
    return this.mes.board(auth);
  }

  @Post('machines/:id/state')
  @HttpCode(200)
  @RequirePermissions(U)
  @ApiZodBody(stateSchema)
  state(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(stateSchema)) b: z.infer<typeof stateSchema>) {
    return this.mes.setManualState(auth, p.id, b);
  }

  @Post('states/:id/reason')
  @HttpCode(200)
  @RequirePermissions(U)
  @ApiZodBody(explainSchema)
  explain(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(explainSchema)) b: z.infer<typeof explainSchema>) {
    return this.mes.explain(auth, p.id, b);
  }

  @Get('downtime')
  @RequirePermissions(R)
  downtime(
    @Auth() auth: AuthContext,
    @Query(body(z.object({ from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(), machineId: z.uuid().optional(), unexplained: z.enum(['true', 'false']).optional() })))
    q: { from?: string; to?: string; machineId?: string; unexplained?: 'true' | 'false' },
  ) {
    return this.mes.downtime(auth, { ...q, unexplained: q.unexplained === 'true' });
  }

  @Get('oee')
  @RequirePermissions(R)
  oee(@Auth() auth: AuthContext, @Query(body(oeeQuery)) q: z.infer<typeof oeeQuery>) {
    return this.mes.oee(auth, q);
  }

  @Get('andon/calls')
  @RequirePermissions(R)
  calls(@Auth() auth: AuthContext, @Query(body(z.object({ open: z.enum(['true', 'false']).default('true') }))) q: { open: 'true' | 'false' }) {
    return this.mes.calls(auth, q.open === 'true');
  }

  @Post('andon/calls')
  @RequirePermissions(U)
  @ApiZodBody(andonSchema)
  raise(@Auth() auth: AuthContext, @Body(body(andonSchema)) b: z.infer<typeof andonSchema>) {
    return this.mes.raiseCall(auth, b);
  }

  @Post('andon/calls/:id/ack')
  @HttpCode(200)
  @RequirePermissions(U)
  ack(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.mes.ackCall(auth, p.id);
  }

  @Post('andon/calls/:id/resolve')
  @HttpCode(200)
  @RequirePermissions(U)
  resolve(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(z.object({ resolution: z.string().trim().max(300).nullable().optional() }))) b: { resolution?: string | null }) {
    return this.mes.resolveCall(auth, p.id, b.resolution ?? null);
  }
}
