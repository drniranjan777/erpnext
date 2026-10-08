import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { approveTimeSchema, linkSchema, loadQuery, milestoneSchema, progressSchema, projectSchema, ProjectsService, resourceSchema, statusSchema, timeSchema, wbsSchema } from './projects.service';

const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const R = 'projects.reports.read';
const M = 'projects.plan.manage';

@ApiTags('Projects')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermissions(R)
  list(@Auth() auth: AuthContext) {
    return this.projects.list(auth);
  }

  @Post()
  @RequirePermissions(M)
  @ApiZodBody(projectSchema)
  create(@Auth() auth: AuthContext, @Body(body(projectSchema)) b: z.infer<typeof projectSchema>) {
    return this.projects.create(auth, b);
  }

  @Get('resource-load')
  @RequirePermissions(R)
  load(@Auth() auth: AuthContext, @Query(body(loadQuery)) q: z.infer<typeof loadQuery>) {
    return this.projects.load(auth, q);
  }

  @Get('documents')
  @RequirePermissions(M)
  documents(@Auth() auth: AuthContext, @Query(body(z.object({ q: z.string().trim().min(1).max(40) }))) q: { q: string }) {
    return this.projects.searchDocuments(auth, q.q);
  }

  @Get(':id')
  @RequirePermissions(R)
  get(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.projects.get(auth, p.id);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions(M)
  @ApiZodBody(statusSchema)
  status(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(statusSchema)) b: z.infer<typeof statusSchema>) {
    return this.projects.setStatus(auth, p.id, b.status);
  }

  @Post(':id/wbs')
  @RequirePermissions(M)
  @ApiZodBody(wbsSchema)
  wbs(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(wbsSchema)) b: z.infer<typeof wbsSchema>) {
    return this.projects.addWbs(auth, p.id, b);
  }

  @Post('wbs/:id/progress')
  @HttpCode(200)
  @RequirePermissions(M)
  @ApiZodBody(progressSchema)
  progress(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(progressSchema)) b: z.infer<typeof progressSchema>) {
    return this.projects.progress(auth, p.id, b);
  }

  @Post(':id/milestones')
  @RequirePermissions(M)
  @ApiZodBody(milestoneSchema)
  milestone(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(milestoneSchema)) b: z.infer<typeof milestoneSchema>) {
    return this.projects.addMilestone(auth, p.id, b);
  }

  @Post('milestones/:id/achieved')
  @HttpCode(200)
  @RequirePermissions(M)
  achieve(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.projects.achieve(auth, p.id);
  }

  @Post('milestones/:id/bill')
  @HttpCode(200)
  @RequirePermissions(M)
  bill(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.projects.bill(auth, p.id, requestMeta(req));
  }

  @Post(':id/costs')
  @RequirePermissions(M)
  @ApiZodBody(linkSchema)
  link(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(linkSchema)) b: z.infer<typeof linkSchema>) {
    return this.projects.link(auth, p.id, b);
  }

  @Post(':id/resources')
  @RequirePermissions(M)
  @ApiZodBody(resourceSchema)
  resource(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(resourceSchema)) b: z.infer<typeof resourceSchema>) {
    return this.projects.addResource(auth, p.id, b);
  }

  @Post(':id/time')
  @RequirePermissions('projects.time.book')
  @ApiZodBody(timeSchema)
  time(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(timeSchema)) b: z.infer<typeof timeSchema>) {
    return this.projects.bookTime(auth, p.id, b);
  }

  @Post(':id/time/approve')
  @HttpCode(200)
  @RequirePermissions('projects.time.approve')
  @ApiZodBody(approveTimeSchema)
  approve(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(approveTimeSchema)) b: z.infer<typeof approveTimeSchema>) {
    return this.projects.approveTime(auth, p.id, b);
  }
}
