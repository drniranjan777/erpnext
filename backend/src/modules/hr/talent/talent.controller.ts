import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../../common/decorators';
import { requestMeta } from '../../../common/request-meta';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import { assessSchema, attendeesSchema, LearningService, resultSchema, skillSchema, trainingSchema } from './learning.service';
import { acceptSeparationSchema, checklistSchema, LifecycleService, separationSchema, taskSchema } from './lifecycle.service';
import { calibrateSchema, cycleSchema, goalSchema, PerformanceService, rateSchema } from './performance.service';
import { acceptSchema, candidateSchema, feedbackSchema, interviewSchema, offerSchema, RecruitmentService, requisitionSchema, stageSchema } from './recruitment.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const decide = new ZodValidationPipe(z.object({ approve: z.boolean() }));
const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);

/**
 * Talent: recruitment, onboarding and exit, performance and learning. Routes without
 * @RequirePermissions are open to employees and check self / manager / HR in the service.
 */
@ApiTags('HR talent')
@ApiBearerAuth()
@Controller('hr')
export class TalentController {
  constructor(
    private readonly recruitment: RecruitmentService,
    private readonly lifecycle: LifecycleService,
    private readonly performance: PerformanceService,
    private readonly learning: LearningService,
  ) {}

  // ---- recruitment ------------------------------------------------------------------------
  @Get('recruitment/requisitions')
  @RequirePermissions('hr.recruitment.read')
  requisitions(
    @Auth() auth: AuthContext,
    @Query(
      body(
        z.object({
          status: z.enum(['pending', 'approved', 'rejected', 'closed']).optional(),
        }),
      ),
    )
    q: { status?: string },
  ) {
    return this.recruitment.requisitions(auth, q.status);
  }
  @Get('recruitment/requisitions/:id')
  @RequirePermissions('hr.recruitment.read')
  requisition(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.recruitment.requisition(auth, p.id);
  }
  @Post('recruitment/requisitions')
  @RequirePermissions('hr.recruitment.manage')
  @ApiZodBody(requisitionSchema)
  raise(@Auth() auth: AuthContext, @Body(body(requisitionSchema)) b: z.infer<typeof requisitionSchema>) {
    return this.recruitment.createRequisition(auth, b);
  }
  @Post('recruitment/requisitions/:id/decide')
  @HttpCode(200)
  @RequirePermissions('hr.recruitment.approve')
  decideRequisition(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(decide) b: { approve: boolean }) {
    return this.recruitment.decideRequisition(auth, p.id, b.approve);
  }
  @Post('recruitment/requisitions/:id/close')
  @HttpCode(200)
  @RequirePermissions('hr.recruitment.manage')
  closeRequisition(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.recruitment.closeRequisition(auth, p.id);
  }
  @Post('recruitment/candidates')
  @RequirePermissions('hr.recruitment.manage')
  @ApiZodBody(candidateSchema)
  addCandidate(@Auth() auth: AuthContext, @Body(body(candidateSchema)) b: z.infer<typeof candidateSchema>) {
    return this.recruitment.addCandidate(auth, b);
  }
  @Post('recruitment/candidates/:id/stage')
  @HttpCode(200)
  @RequirePermissions('hr.recruitment.manage')
  stage(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(stageSchema)) b: z.infer<typeof stageSchema>) {
    return this.recruitment.setStage(auth, p.id, b);
  }
  @Post('recruitment/candidates/:id/interviews')
  @RequirePermissions('hr.recruitment.manage')
  @ApiZodBody(interviewSchema)
  schedule(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(interviewSchema)) b: z.infer<typeof interviewSchema>) {
    return this.recruitment.scheduleInterview(auth, p.id, b);
  }
  @Post('recruitment/interviews/:id/feedback')
  @HttpCode(200)
  @ApiZodBody(feedbackSchema)
  feedback(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(feedbackSchema)) b: z.infer<typeof feedbackSchema>) {
    return this.recruitment.feedback(auth, p.id, b);
  }
  @Get('recruitment/my-interviews')
  myInterviews(@Auth() auth: AuthContext) {
    return this.recruitment.myInterviews(auth);
  }
  @Post('recruitment/offers')
  @RequirePermissions('hr.recruitment.manage')
  @ApiZodBody(offerSchema)
  offer(@Auth() auth: AuthContext, @Body(body(offerSchema)) b: z.infer<typeof offerSchema>) {
    return this.recruitment.createOffer(auth, b);
  }
  @Post('recruitment/offers/:id/decide')
  @HttpCode(200)
  @RequirePermissions('hr.recruitment.approve')
  decideOffer(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(decide) b: { approve: boolean }) {
    return this.recruitment.decideOffer(auth, p.id, b.approve);
  }
  @Post('recruitment/offers/:id/respond')
  @HttpCode(200)
  @RequirePermissions('hr.recruitment.manage')
  respond(
    @Auth() auth: AuthContext,
    @Param(idPipe) p: { id: string },
    @Body(body(z.object({ answer: z.enum(['declined', 'withdrawn']) })))
    b: { answer: 'declined' | 'withdrawn' },
  ) {
    return this.recruitment.respond(auth, p.id, b.answer);
  }
  @Post('recruitment/offers/:id/accept')
  @HttpCode(200)
  @RequirePermissions('hr.recruitment.manage', 'hr.employees.manage')
  @ApiZodBody(acceptSchema)
  accept(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(acceptSchema)) b: z.infer<typeof acceptSchema>, @Req() req: AppRequest) {
    return this.recruitment.accept(auth, p.id, b, requestMeta(req));
  }

  // ---- onboarding, exit and settlement ----------------------------------------------------
  @Get('checklists')
  @RequirePermissions('hr.exit.read')
  checklists(@Auth() auth: AuthContext) {
    return this.lifecycle.checklists(auth);
  }
  @Post('checklists')
  @RequirePermissions('hr.exit.manage')
  @ApiZodBody(checklistSchema)
  addChecklist(@Auth() auth: AuthContext, @Body(body(checklistSchema)) b: z.infer<typeof checklistSchema>) {
    return this.lifecycle.saveChecklist(auth, null, b);
  }
  @Put('checklists/:id')
  @RequirePermissions('hr.exit.manage')
  @ApiZodBody(checklistSchema)
  updateChecklist(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(checklistSchema)) b: z.infer<typeof checklistSchema>) {
    return this.lifecycle.saveChecklist(auth, p.id, b);
  }
  @Get('tasks')
  @RequirePermissions('hr.exit.read')
  tasks(
    @Auth() auth: AuthContext,
    @Query(
      body(
        z.object({
          kind: z.enum(['onboarding', 'exit']).optional(),
          employeeId: z.uuid().optional(),
          status: z.enum(['pending', 'done', 'not_needed']).optional(),
        }),
      ),
    )
    q: { kind?: string; employeeId?: string; status?: string },
  ) {
    return this.lifecycle.tasks(auth, q);
  }
  @Put('tasks/:id')
  @RequirePermissions('hr.exit.manage')
  @ApiZodBody(taskSchema)
  updateTask(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(taskSchema)) b: z.infer<typeof taskSchema>) {
    return this.lifecycle.updateTask(auth, p.id, b);
  }
  @Get('separations')
  @RequirePermissions('hr.exit.read')
  separations(
    @Auth() auth: AuthContext,
    @Query(
      body(
        z.object({
          status: z.enum(['requested', 'accepted', 'settled', 'withdrawn']).optional(),
        }),
      ),
    )
    q: { status?: string },
  ) {
    return this.lifecycle.separations(auth, q.status);
  }
  @Get('separations/mine')
  mySeparation(@Auth() auth: AuthContext) {
    return this.lifecycle.mine(auth);
  }
  @Post('separations')
  @ApiZodBody(separationSchema)
  separate(@Auth() auth: AuthContext, @Body(body(separationSchema)) b: z.infer<typeof separationSchema>) {
    return this.lifecycle.create(auth, b);
  }
  @Post('separations/:id/accept')
  @HttpCode(200)
  @RequirePermissions('hr.exit.manage')
  @ApiZodBody(acceptSeparationSchema)
  acceptSeparation(
    @Auth() auth: AuthContext,
    @Param(idPipe) p: { id: string },
    @Body(body(acceptSeparationSchema))
    b: z.infer<typeof acceptSeparationSchema>,
  ) {
    return this.lifecycle.accept(auth, p.id, b);
  }
  @Post('separations/:id/withdraw')
  @HttpCode(200)
  withdraw(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.lifecycle.withdraw(auth, p.id);
  }
  @Get('separations/:id/settlement')
  @RequirePermissions('hr.exit.read')
  settlement(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.lifecycle.settlement(auth, p.id);
  }
  @Post('separations/:id/settle')
  @HttpCode(200)
  @RequirePermissions('hr.exit.settle')
  settle(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.lifecycle.settle(auth, p.id, requestMeta(req));
  }

  // ---- performance ------------------------------------------------------------------------
  @Get('performance/cycles')
  cycles(@Auth() auth: AuthContext) {
    return this.performance.cycles(auth);
  }
  @Post('performance/cycles')
  @RequirePermissions('hr.performance.manage')
  @ApiZodBody(cycleSchema)
  addCycle(@Auth() auth: AuthContext, @Body(body(cycleSchema)) b: z.infer<typeof cycleSchema>) {
    return this.performance.createCycle(auth, b);
  }
  @Post('performance/cycles/:id/status')
  @HttpCode(200)
  @RequirePermissions('hr.performance.manage')
  cycleStatus(
    @Auth() auth: AuthContext,
    @Param(idPipe) p: { id: string },
    @Body(body(z.object({ status: z.enum(['goal_setting', 'review', 'closed']) })))
    b: { status: 'goal_setting' | 'review' | 'closed' },
  ) {
    return this.performance.setStatus(auth, p.id, b.status);
  }
  @Get('performance/cycles/:id/goals')
  goals(
    @Auth() auth: AuthContext,
    @Param(idPipe) p: { id: string },
    @Query(body(z.object({ employeeId: z.uuid().optional() })))
    q: { employeeId?: string },
  ) {
    return this.performance.goals(auth, p.id, q.employeeId);
  }
  @Post('performance/cycles/:id/goals')
  @ApiZodBody(goalSchema)
  addGoal(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(goalSchema)) b: z.infer<typeof goalSchema>) {
    return this.performance.addGoal(auth, p.id, b);
  }
  @Delete('performance/goals/:id')
  removeGoal(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.performance.removeGoal(auth, p.id);
  }
  @Post('performance/goals/:id/rate')
  @HttpCode(200)
  @ApiZodBody(rateSchema)
  rate(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(rateSchema)) b: z.infer<typeof rateSchema>) {
    return this.performance.rate(auth, p.id, b);
  }
  @Get('performance/cycles/:id/appraisals')
  @RequirePermissions('hr.performance.read')
  appraisals(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.performance.appraisals(auth, p.id);
  }
  @Post('performance/cycles/:id/calibrate')
  @HttpCode(200)
  @RequirePermissions('hr.performance.manage')
  @ApiZodBody(calibrateSchema)
  calibrate(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(calibrateSchema)) b: z.infer<typeof calibrateSchema>) {
    return this.performance.calibrate(auth, p.id, b);
  }
  @Post('performance/cycles/:id/apply')
  @HttpCode(200)
  @RequirePermissions('hr.performance.manage', 'payroll.salaries.manage')
  applyIncrements(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.performance.apply(auth, p.id);
  }

  // ---- learning ---------------------------------------------------------------------------
  @Get('skills')
  @RequirePermissions('hr.training.read')
  skills(@Auth() auth: AuthContext) {
    return this.learning.skills(auth);
  }
  @Get('skills/matrix')
  @RequirePermissions('hr.training.read')
  matrix(
    @Auth() auth: AuthContext,
    @Query(
      body(
        z.object({
          departmentId: z.uuid().optional(),
          category: z.string().max(40).optional(),
        }),
      ),
    )
    q: { departmentId?: string; category?: string },
  ) {
    return this.learning.matrix(auth, {
      departmentId: q.departmentId,
      skillCategory: q.category,
    });
  }
  @Post('skills')
  @RequirePermissions('hr.training.manage')
  @ApiZodBody(skillSchema)
  addSkill(@Auth() auth: AuthContext, @Body(body(skillSchema)) b: z.infer<typeof skillSchema>) {
    return this.learning.saveSkill(auth, null, b);
  }
  @Put('skills/:id')
  @RequirePermissions('hr.training.manage')
  @ApiZodBody(skillSchema)
  updateSkill(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(skillSchema)) b: z.infer<typeof skillSchema>) {
    return this.learning.saveSkill(auth, p.id, b);
  }
  @Post('skills/assess')
  @HttpCode(200)
  @RequirePermissions('hr.training.manage')
  @ApiZodBody(assessSchema)
  assess(@Auth() auth: AuthContext, @Body(body(assessSchema)) b: z.infer<typeof assessSchema>) {
    return this.learning.assess(auth, b);
  }
  @Get('trainings')
  @RequirePermissions('hr.training.read')
  trainings(
    @Auth() auth: AuthContext,
    @Query(
      body(
        z.object({
          from: z.iso.date().optional(),
          to: z.iso.date().optional(),
        }),
      ),
    )
    q: { from?: string; to?: string },
  ) {
    return this.learning.trainings(auth, q);
  }
  @Get('trainings/mine')
  myTrainings(@Auth() auth: AuthContext) {
    return this.learning.mine(auth);
  }
  @Get('trainings/:id')
  @RequirePermissions('hr.training.read')
  training(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.learning.training(auth, p.id);
  }
  @Post('trainings')
  @RequirePermissions('hr.training.manage')
  @ApiZodBody(trainingSchema)
  addTraining(@Auth() auth: AuthContext, @Body(body(trainingSchema)) b: z.infer<typeof trainingSchema>) {
    return this.learning.createTraining(auth, b);
  }
  @Post('trainings/:id/nominate')
  @HttpCode(200)
  @RequirePermissions('hr.training.manage')
  nominate(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(attendeesSchema)) b: z.infer<typeof attendeesSchema>) {
    return this.learning.nominate(auth, p.id, b);
  }
  @Post('trainings/:id/results')
  @HttpCode(200)
  @RequirePermissions('hr.training.manage')
  results(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(resultSchema)) b: z.infer<typeof resultSchema>) {
    return this.learning.record(auth, p.id, b);
  }
  @Post('trainings/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('hr.training.manage')
  cancelTraining(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.learning.cancel(auth, p.id);
  }
}
