import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Auth, RequirePermissions } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AiGovService, modelSchema, policySchema } from './ai-gov.service';
import { EVAL_SUITES, type EvalSuite } from './evals';

const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);

@ApiTags('AI governance')
@ApiBearerAuth()
@Controller('ai/governance')
export class AiGovController {
  constructor(private readonly gov: AiGovService) {}

  @Get()
  @RequirePermissions('ai.governance.manage')
  get(@Auth() auth: AuthContext) {
    return this.gov.get(auth);
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions('ai.governance.manage')
  save(@Auth() auth: AuthContext, @Body(body(policySchema)) b: z.infer<typeof policySchema>) {
    return this.gov.save(auth, b);
  }

  @Get('models')
  @RequirePermissions('ai.governance.manage')
  models(@Auth() auth: AuthContext) {
    return this.gov.models(auth);
  }

  @Post('models')
  @RequirePermissions('ai.governance.manage')
  setModel(@Auth() auth: AuthContext, @Body(body(modelSchema)) b: z.infer<typeof modelSchema>) {
    return this.gov.setModel(auth, b);
  }

  @Get('usage')
  @RequirePermissions('ai.governance.manage')
  usage(
    @Auth() auth: AuthContext,
    @Query(body(z.object({ days: z.coerce.number().int().min(1).max(366).default(30) })))
    q: { days: number },
  ) {
    return this.gov.usage(auth, q.days);
  }

  @Get('evals')
  @RequirePermissions('ai.governance.manage')
  evals(@Auth() auth: AuthContext) {
    return this.gov.evals(auth);
  }

  @Post('evals/:suite')
  @RequirePermissions('ai.governance.manage')
  runEval(
    @Auth() auth: AuthContext,
    @Param(
      body(
        z.object({
          suite: z.enum(Object.keys(EVAL_SUITES) as [EvalSuite, ...EvalSuite[]]),
        }),
      ),
    )
    p: { suite: EvalSuite },
  ) {
    return this.gov.runEval(auth, p.suite);
  }
}
