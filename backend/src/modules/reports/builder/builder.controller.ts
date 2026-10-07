import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthContext } from '../../../common/auth-context';
import { ApiZodBody, Auth } from '../../../common/decorators';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import { specSchema, type Spec } from './builder';
import { BuilderService, savedReportSchema, type SavedReportInput } from './builder.service';
import { scheduleSchema, SchedulesService, type ScheduleInput } from './schedules.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const file = (f: { name: string; type: string; body: Buffer }) => new StreamableFile(f.body, { type: f.type, length: f.body.length, disposition: `attachment; filename="${f.name}"` });

/** Datasets check their own permissions; saved reports are the owner's or shared. */
@ApiTags('Reports')
@ApiBearerAuth()
@Controller('report-builder')
export class BuilderController {
  constructor(private readonly builder: BuilderService) {}

  @Get('datasets')
  datasets(@Auth() auth: AuthContext) {
    return this.builder.datasets(auth);
  }
  @Post('run')
  @HttpCode(200)
  @ApiZodBody(specSchema)
  run(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(specSchema)) b: Spec) {
    return this.builder.runSpec(auth, b);
  }
  @Post('export')
  @HttpCode(200)
  async export(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(z.object({ spec: specSchema, format: z.enum(['xlsx', 'csv']).default('xlsx'), title: z.string().max(80).optional() }))) b: { spec: Spec; format: 'xlsx' | 'csv'; title?: string }) {
    return file(await this.builder.exportSpec(auth, b.spec, b.format, b.title ?? 'Custom report', (b.title ?? 'custom-report').toLowerCase().replace(/[^a-z0-9]+/g, '-')));
  }
  @Get('saved')
  list(@Auth() auth: AuthContext) {
    return this.builder.list(auth);
  }
  @Get('saved/:id')
  get(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.builder.get(auth, p.id);
  }
  @Get('saved/:id/run')
  runSaved(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.builder.run(auth, p.id);
  }
  @Post('saved')
  @ApiZodBody(savedReportSchema)
  create(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(savedReportSchema)) b: SavedReportInput) {
    return this.builder.save(auth, null, b);
  }
  @Put('saved/:id')
  @ApiZodBody(savedReportSchema)
  update(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(savedReportSchema)) b: SavedReportInput) {
    return this.builder.save(auth, p.id, b);
  }
  @Delete('saved/:id')
  @HttpCode(204)
  remove(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.builder.remove(auth, p.id);
  }
}

/** A user's scheduled deliveries; each runs with its owner's permissions. */
@ApiTags('Reports')
@ApiBearerAuth()
@Controller('report-schedules')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get()
  list(@Auth() auth: AuthContext) {
    return this.schedules.list(auth);
  }
  @Post()
  @ApiZodBody(scheduleSchema)
  create(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(scheduleSchema)) b: ScheduleInput) {
    return this.schedules.save(auth, null, b);
  }
  @Put(':id')
  @ApiZodBody(scheduleSchema)
  update(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(scheduleSchema)) b: ScheduleInput) {
    return this.schedules.save(auth, p.id, b);
  }
  @Delete(':id')
  @HttpCode(204)
  remove(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.schedules.remove(auth, p.id);
  }
  @Post(':id/run')
  @HttpCode(200)
  run(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.schedules.runNow(auth, p.id);
  }
}
