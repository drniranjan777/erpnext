import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { firstOffSchema, inlineSchema, instructionSchema, jobSchema, loginSchema, MesExecutionService, recipeSchema, skillSchema } from './execution.service';

const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const itemQuery = new ZodValidationPipe(z.object({ itemId: z.uuid().optional() }));
const R = 'mes.oee.read';
const W = 'mes.instructions.manage';
const FLOOR = 'mes.shopfloor.use';

@ApiTags('MES execution')
@ApiBearerAuth()
@Controller('mes')
export class MesExecutionController {
  constructor(private readonly exec: MesExecutionService) {}

  // ---- instructions and recipes ----

  @Get('instructions')
  @RequirePermissions(R)
  instructions(@Auth() auth: AuthContext, @Query(itemQuery) q: { itemId?: string }) {
    return this.exec.instructions(auth, q.itemId);
  }

  @Get('instructions/:id')
  @RequirePermissions(R)
  instruction(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.exec.instruction(auth, p.id);
  }

  @Post('instructions')
  @RequirePermissions(W)
  @ApiZodBody(instructionSchema)
  createInstruction(@Auth() auth: AuthContext, @Body(body(instructionSchema)) b: z.infer<typeof instructionSchema>) {
    return this.exec.saveInstruction(auth, null, b);
  }

  @Put('instructions/:id')
  @RequirePermissions(W)
  @ApiZodBody(instructionSchema)
  updateInstruction(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(instructionSchema)) b: z.infer<typeof instructionSchema>) {
    return this.exec.saveInstruction(auth, p.id, b);
  }

  @Post('instructions/:id/release')
  @HttpCode(200)
  @RequirePermissions(W)
  releaseInstruction(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.exec.release(auth, p.id, 'instruction');
  }

  @Get('recipes')
  @RequirePermissions(R)
  recipes(@Auth() auth: AuthContext, @Query(itemQuery) q: { itemId?: string }) {
    return this.exec.recipes(auth, q.itemId);
  }

  @Post('recipes')
  @RequirePermissions(W)
  @ApiZodBody(recipeSchema)
  createRecipe(@Auth() auth: AuthContext, @Body(body(recipeSchema)) b: z.infer<typeof recipeSchema>) {
    return this.exec.saveRecipe(auth, null, b);
  }

  @Put('recipes/:id')
  @RequirePermissions(W)
  @ApiZodBody(recipeSchema)
  updateRecipe(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(recipeSchema)) b: z.infer<typeof recipeSchema>) {
    return this.exec.saveRecipe(auth, p.id, b);
  }

  @Post('recipes/:id/release')
  @HttpCode(200)
  @RequirePermissions(W)
  releaseRecipe(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.exec.release(auth, p.id, 'recipe');
  }

  // ---- skills and log-in ----

  @Get('skills')
  @RequirePermissions(R)
  skills(@Auth() auth: AuthContext) {
    return this.exec.skills(auth);
  }

  @Post('skills')
  @RequirePermissions(W)
  @ApiZodBody(skillSchema)
  addSkill(@Auth() auth: AuthContext, @Body(body(skillSchema)) b: z.infer<typeof skillSchema>) {
    return this.exec.addSkill(auth, b);
  }

  @Delete('skills/:id')
  @RequirePermissions(W)
  removeSkill(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.exec.removeSkill(auth, p.id);
  }

  @Post('machines/:id/login')
  @RequirePermissions(FLOOR)
  @ApiZodBody(loginSchema)
  login(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(loginSchema)) b: z.infer<typeof loginSchema>) {
    return this.exec.login(auth, p.id, b.operatorName);
  }

  @Post('machines/:id/logout')
  @HttpCode(200)
  @RequirePermissions(FLOOR)
  logout(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.exec.logout(auth, p.id);
  }

  @Get('machines/:id/terminal')
  @RequirePermissions(FLOOR)
  terminal(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.exec.terminal(auth, p.id);
  }

  // ---- jobs ----

  @Get('jobs/prepare')
  @RequirePermissions(FLOOR)
  prepare(@Auth() auth: AuthContext, @Query(body(z.object({ operationId: z.uuid(), machineId: z.uuid() }))) q: { operationId: string; machineId: string }) {
    return this.exec.prepare(auth, q.operationId, q.machineId);
  }

  @Post('jobs/check')
  @HttpCode(200)
  @RequirePermissions(FLOOR)
  @ApiZodBody(jobSchema)
  check(@Auth() auth: AuthContext, @Body(body(jobSchema)) b: z.infer<typeof jobSchema>) {
    return this.exec.check(auth, b);
  }

  @Post('jobs/start')
  @RequirePermissions(FLOOR, 'manufacturing.shopfloor.record')
  @ApiZodBody(jobSchema)
  start(@Auth() auth: AuthContext, @Body(body(jobSchema)) b: z.infer<typeof jobSchema>) {
    return this.exec.start(auth, b);
  }

  @Get('executions')
  @RequirePermissions(R)
  executions(@Auth() auth: AuthContext, @Query(body(z.object({ machineId: z.uuid().optional(), workOrderId: z.uuid().optional() }))) q: { machineId?: string; workOrderId?: string }) {
    return this.exec.executions(auth, q);
  }

  @Get('executions/:id')
  @RequirePermissions(R)
  execution(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.exec.get(auth, p.id);
  }

  @Post('executions/:id/first-off')
  @HttpCode(200)
  @RequirePermissions('mes.firstoff.approve')
  @ApiZodBody(firstOffSchema)
  firstOff(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(firstOffSchema)) b: z.infer<typeof firstOffSchema>) {
    return this.exec.firstOff(auth, p.id, b);
  }

  @Post('executions/:id/inline')
  @HttpCode(200)
  @RequirePermissions(FLOOR)
  @ApiZodBody(inlineSchema)
  inline(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(inlineSchema)) b: z.infer<typeof inlineSchema>) {
    return this.exec.inline(auth, p.id, b);
  }
}
