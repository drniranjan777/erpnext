import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { closeSchema, openSchema, PosService, returnSchema, saleSchema, terminalSchema } from './pos.service';

const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const U = 'pos.sales.use';
const M = 'pos.terminals.manage';

@ApiTags('Point of sale')
@ApiBearerAuth()
@Controller()
export class PosController {
  constructor(private readonly pos: PosService) {}

  @Get('pos/terminals')
  @RequirePermissions(U)
  terminals(@Auth() auth: AuthContext) {
    return this.pos.terminals(auth);
  }

  @Post('pos/terminals')
  @RequirePermissions(M)
  @ApiZodBody(terminalSchema)
  createTerminal(@Auth() auth: AuthContext, @Body(body(terminalSchema)) b: z.infer<typeof terminalSchema>, @Req() req: AppRequest) {
    return this.pos.createTerminal(auth, b, requestMeta(req));
  }

  @Get('pos/terminals/:id/items')
  @RequirePermissions(U)
  items(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(body(z.object({ q: z.string().trim().min(1).max(60) }))) q: { q: string }) {
    return this.pos.items(auth, p.id, q.q);
  }

  @Post('pos/sessions')
  @RequirePermissions(U)
  @ApiZodBody(openSchema)
  open(@Auth() auth: AuthContext, @Body(body(openSchema)) b: z.infer<typeof openSchema>) {
    return this.pos.open(auth, b);
  }

  @Get('pos/sessions')
  @RequirePermissions(M)
  sessions(@Auth() auth: AuthContext) {
    return this.pos.sessions(auth);
  }

  @Get('pos/sessions/:id')
  @RequirePermissions(U)
  session(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.pos.getSession(auth, p.id);
  }

  @Post('pos/sessions/:id/sales')
  @RequirePermissions(U)
  @ApiZodBody(saleSchema)
  sell(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(saleSchema)) b: z.infer<typeof saleSchema>, @Req() req: AppRequest) {
    return this.pos.sell(auth, p.id, b, requestMeta(req));
  }

  @Post('pos/sessions/:id/sales/:saleId/return')
  @RequirePermissions(U)
  @ApiZodBody(returnSchema)
  refund(@Auth() auth: AuthContext, @Param(new ZodValidationPipe(z.object({ id: z.uuid(), saleId: z.uuid() }))) p: { id: string; saleId: string }, @Body(body(returnSchema)) b: z.infer<typeof returnSchema>, @Req() req: AppRequest) {
    return this.pos.refund(auth, p.id, p.saleId, b, requestMeta(req));
  }

  @Post('pos/sessions/:id/close')
  @HttpCode(200)
  @RequirePermissions(U)
  @ApiZodBody(closeSchema)
  close(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(closeSchema)) b: z.infer<typeof closeSchema>) {
    return this.pos.close(auth, p.id, b);
  }

  @Get('pos/sales/:id/receipt')
  @RequirePermissions(U)
  receipt(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.pos.receipt(auth, p.id);
  }

  /** The owner's phone home screen: today's figures and approvals waiting. */
  @Get('mobile/summary')
  summary(@Auth() auth: AuthContext) {
    return this.pos.ownerSummary(auth);
  }
}
