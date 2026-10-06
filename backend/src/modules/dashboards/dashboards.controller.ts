import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { dashboardSchema, DashboardsService, type DashboardInput } from './dashboards.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));

/** Every widget checks its own permission, so the endpoints only need a signed-in user. */
@ApiTags('Dashboards')
@ApiBearerAuth()
@Controller('dashboards')
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get('widgets')
  widgets(@Auth() auth: AuthContext) {
    return this.dashboards.widgets(auth);
  }
  @Get()
  list(@Auth() auth: AuthContext) {
    return this.dashboards.list(auth);
  }
  @Get('view')
  view(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ id: z.uuid().optional(), preset: z.string().max(30).optional() }))) q: { id?: string; preset?: string }) {
    return this.dashboards.view(auth, q);
  }
  @Post()
  @ApiZodBody(dashboardSchema)
  create(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(dashboardSchema)) b: DashboardInput) {
    return this.dashboards.save(auth, null, b);
  }
  @Put(':id')
  @ApiZodBody(dashboardSchema)
  update(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(dashboardSchema)) b: DashboardInput) {
    return this.dashboards.save(auth, p.id, b);
  }
  @Delete(':id')
  @HttpCode(204)
  remove(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.dashboards.remove(auth, p.id);
  }
}
