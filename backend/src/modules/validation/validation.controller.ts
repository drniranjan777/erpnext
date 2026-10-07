import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { executeSchema, projectSchema, riskSchema, signSchema, testSchema, ValidationService } from './validation.service';

const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const testPipe = new ZodValidationPipe(z.object({ id: z.uuid(), testId: z.uuid() }));
const M = 'validation.projects.manage';

@ApiTags('Validation')
@ApiBearerAuth()
@Controller('validation')
export class ValidationController {
  constructor(private readonly v: ValidationService) {}

  @Get('catalogue')
  @RequirePermissions(M)
  catalogue() {
    return this.v.catalogue();
  }

  @Get('projects')
  @RequirePermissions(M)
  projects(@Auth() auth: AuthContext) {
    return this.v.projects(auth);
  }

  @Post('projects')
  @RequirePermissions(M)
  @ApiZodBody(projectSchema)
  create(@Auth() auth: AuthContext, @Body(body(projectSchema)) b: z.infer<typeof projectSchema>) {
    return this.v.create(auth, b);
  }

  @Get('projects/:id')
  @RequirePermissions(M)
  get(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.v.get(auth, p.id);
  }

  @Post('projects/:id/risks')
  @HttpCode(200)
  @RequirePermissions(M)
  @ApiZodBody(riskSchema)
  risk(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(riskSchema)) b: z.infer<typeof riskSchema>) {
    return this.v.setRisk(auth, p.id, b);
  }

  @Post('projects/:id/tests')
  @RequirePermissions(M)
  @ApiZodBody(testSchema)
  addTest(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(testSchema)) b: z.infer<typeof testSchema>) {
    return this.v.addTest(auth, p.id, b);
  }

  @Post('projects/:id/tests/:testId/execute')
  @HttpCode(200)
  @RequirePermissions(M)
  @ApiZodBody(executeSchema)
  execute(@Auth() auth: AuthContext, @Param(testPipe) p: { id: string; testId: string }, @Body(body(executeSchema)) b: z.infer<typeof executeSchema>) {
    return this.v.execute(auth, p.id, p.testId, b);
  }

  @Post('projects/:id/iq/run')
  @HttpCode(200)
  @RequirePermissions(M)
  runIq(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.v.runIq(auth, p.id);
  }

  @Post('projects/:id/sign')
  @HttpCode(200)
  @RequirePermissions('validation.documents.approve')
  @ApiZodBody(signSchema)
  sign(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(signSchema)) b: z.infer<typeof signSchema>, @Req() req: AppRequest) {
    return this.v.sign(auth, p.id, b, requestMeta(req));
  }
}
