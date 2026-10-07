import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { agentConfigSchema, AgentsService, decideSchema, killSchema } from './agents.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const codePipe = new ZodValidationPipe(z.object({ code: z.string().regex(/^[a-z_]{2,30}$/) }));
const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const USE = 'ai.inbox.use';
const MANAGE = 'ai.agents.manage';

@ApiTags('AI agents')
@ApiBearerAuth()
@Controller('ai')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get('agents')
  @RequirePermissions(USE)
  list(@Auth() auth: AuthContext) {
    return this.agents.list(auth);
  }

  @Put('agents/:code')
  @RequirePermissions(MANAGE)
  save(@Auth() auth: AuthContext, @Param(codePipe) p: { code: string }, @Body(body(agentConfigSchema)) b: z.infer<typeof agentConfigSchema>) {
    return this.agents.save(auth, p.code, b);
  }

  @Post('agents/:code/run')
  @HttpCode(200)
  @RequirePermissions(MANAGE)
  run(@Auth() auth: AuthContext, @Param(codePipe) p: { code: string }) {
    return this.agents.runNow(auth, p.code);
  }

  @Post('kill-switch')
  @HttpCode(200)
  @RequirePermissions(MANAGE)
  kill(@Auth() auth: AuthContext, @Body(body(killSchema)) b: z.infer<typeof killSchema>) {
    return this.agents.kill(auth, b);
  }

  @Get('inbox')
  @RequirePermissions(USE)
  inbox(@Auth() auth: AuthContext, @Query(body(z.object({ status: z.enum(['open', 'accepted', 'dismissed', 'executed', 'failed', 'expired']).optional(), agent: z.string().max(30).optional() }))) q: { status?: string; agent?: string }) {
    return this.agents.inbox(auth, q);
  }

  @Post('inbox/:id/decide')
  @HttpCode(200)
  @RequirePermissions(USE)
  decide(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(decideSchema)) b: z.infer<typeof decideSchema>, @Req() req: AppRequest) {
    return this.agents.decide(auth, p.id, b, requestMeta(req));
  }

  @Get('runs')
  @RequirePermissions(USE)
  runs(@Auth() auth: AuthContext, @Query(body(z.object({ agent: z.string().max(30).optional() }))) q: { agent?: string }) {
    return this.agents.runs(auth, q.agent);
  }

  @Get('actions')
  @RequirePermissions(MANAGE)
  actions(@Auth() auth: AuthContext) {
    return this.agents.actionLog(auth);
  }

  @Get('evaluation')
  @RequirePermissions(USE)
  evaluation(@Auth() auth: AuthContext, @Query(body(z.object({ days: z.coerce.number().int().min(1).max(365).default(90) }))) q: { days: number }) {
    return this.agents.evaluate(auth, q.days);
  }
}
