import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, Public, RequirePermissions } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { whatIfSchema } from '../planning/scheduling.service';
import { layoutSchema, TwinService } from './twin.service';
import { deploySchema, inspectionsSchema, modelSchema, reviewSchema, VisionService } from './vision.service';

const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));

@ApiTags('Digital twin')
@ApiBearerAuth()
@Controller('twin')
export class TwinController {
  constructor(private readonly twin: TwinService) {}

  @Get('layouts')
  @RequirePermissions('mes.oee.read')
  layouts(@Auth() auth: AuthContext) {
    return this.twin.layouts(auth);
  }

  @Get('layouts/default')
  @RequirePermissions('mes.oee.read')
  defaultLayout(@Auth() auth: AuthContext) {
    return this.twin.defaultLayout(auth);
  }

  @Get('layouts/:id')
  @RequirePermissions('mes.oee.read')
  get(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.twin.get(auth, p.id);
  }

  @Get('layouts/:id/live')
  @RequirePermissions('mes.oee.read')
  live(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.twin.live(auth, p.id);
  }

  @Post('layouts')
  @RequirePermissions('twin.layouts.manage')
  @ApiZodBody(layoutSchema)
  create(@Auth() auth: AuthContext, @Body(body(layoutSchema)) b: z.infer<typeof layoutSchema>) {
    return this.twin.save(auth, null, b);
  }

  @Put('layouts/:id')
  @RequirePermissions('twin.layouts.manage')
  @ApiZodBody(layoutSchema)
  update(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(layoutSchema)) b: z.infer<typeof layoutSchema>) {
    return this.twin.save(auth, p.id, b);
  }

  @Delete('layouts/:id')
  @RequirePermissions('twin.layouts.manage')
  remove(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.twin.remove(auth, p.id);
  }

  @Post('simulate')
  @HttpCode(200)
  @RequirePermissions('twin.schedule.simulate', 'manufacturing.production.read')
  @ApiZodBody(whatIfSchema)
  simulate(@Auth() auth: AuthContext, @Body(body(whatIfSchema)) b: z.infer<typeof whatIfSchema>) {
    return this.twin.simulate(auth, b);
  }
}

@ApiTags('Vision inspection')
@ApiBearerAuth()
@Controller('vision')
export class VisionController {
  constructor(private readonly vision: VisionService) {}

  @Get('models')
  @RequirePermissions('vision.inspections.read')
  models(@Auth() auth: AuthContext) {
    return this.vision.models(auth);
  }

  @Post('models')
  @RequirePermissions('vision.models.manage')
  @ApiZodBody(modelSchema)
  create(@Auth() auth: AuthContext, @Body(body(modelSchema)) b: z.infer<typeof modelSchema>) {
    return this.vision.createModel(auth, b);
  }

  @Post('models/:id/deploy')
  @HttpCode(200)
  @RequirePermissions('vision.models.manage')
  @ApiZodBody(deploySchema)
  deploy(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(deploySchema)) b: z.infer<typeof deploySchema>) {
    return this.vision.deploy(auth, p.id, b.gatewayIds);
  }

  @Get('inspections')
  @RequirePermissions('vision.inspections.read')
  inspections(
    @Auth() auth: AuthContext,
    @Query(body(z.object({ machineId: z.uuid().optional(), modelId: z.uuid().optional(), result: z.enum(['ok', 'defect']).optional(), toReview: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) })))
    q: { machineId?: string; modelId?: string; result?: 'ok' | 'defect'; toReview?: 'true' | 'false'; limit: number },
  ) {
    return this.vision.inspections(auth, { ...q, toReview: q.toReview === 'true' });
  }

  @Post('inspections/:id/review')
  @HttpCode(200)
  @RequirePermissions('vision.inspections.read')
  @ApiZodBody(reviewSchema)
  review(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(reviewSchema)) b: z.infer<typeof reviewSchema>) {
    return this.vision.review(auth, p.id, b);
  }

  @Get('monitoring')
  @RequirePermissions('vision.inspections.read')
  monitoring(@Auth() auth: AuthContext) {
    return this.vision.monitoring(auth);
  }
}

/** Inspection results from edge gateways (device token). */
@ApiTags('IoT devices')
@Public()
@Controller('iot/device')
export class VisionDeviceController {
  constructor(private readonly vision: VisionService) {}

  @Post('inspections')
  @HttpCode(200)
  @ApiZodBody(inspectionsSchema)
  ingest(@Headers('x-device-token') token: string | undefined, @Body(body(inspectionsSchema)) b: z.infer<typeof inspectionsSchema>) {
    return this.vision.ingest(token, b);
  }
}
