import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { Auth } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { executeSchema, interpretSchema, VoiceService } from './voice.service';

const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);

/** Voice commands. Open to every signed-in user; what a command creates still needs its own permission. */
@ApiTags('Voice')
@ApiBearerAuth()
@Controller('voice')
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  @Post('interpret')
  @HttpCode(200)
  interpret(@Auth() auth: AuthContext, @Body(body(interpretSchema)) b: z.infer<typeof interpretSchema>) {
    return this.voice.interpret(auth, b);
  }

  @Post('execute')
  @HttpCode(200)
  execute(@Auth() auth: AuthContext, @Body(body(executeSchema)) b: z.infer<typeof executeSchema>, @Req() req: AppRequest) {
    return this.voice.execute(auth, b, requestMeta(req));
  }

  @Post('logs/:id/cancel')
  @HttpCode(200)
  cancel(@Auth() auth: AuthContext, @Param(body(z.object({ id: z.uuid() }))) p: { id: string }) {
    return this.voice.cancel(auth, p.id);
  }

  @Get('stats')
  stats(@Auth() auth: AuthContext, @Query(body(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }))) q: { days: number }) {
    return this.voice.stats(auth, q.days);
  }
}
