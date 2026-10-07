import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { cmModelSchema, energySettingsSchema, feedbackSchema, PlantService } from './plant.service';

const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const R = 'iot.data.read';
const M = 'iot.devices.manage';
const rangeQuery = z.object({ from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional() });

@ApiTags('Plant monitoring')
@ApiBearerAuth()
@Controller('plant')
export class PlantController {
  constructor(private readonly plant: PlantService) {}

  @Get('energy')
  @RequirePermissions(R)
  energy(@Auth() auth: AuthContext, @Query(body(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    return this.plant.energy(auth, q);
  }

  @Get('energy/settings')
  @RequirePermissions(R)
  energySettings(@Auth() auth: AuthContext) {
    return this.plant.getEnergySettings(auth);
  }

  @Put('energy/settings')
  @RequirePermissions(M)
  @ApiZodBody(energySettingsSchema)
  saveEnergySettings(@Auth() auth: AuthContext, @Body(body(energySettingsSchema)) b: z.infer<typeof energySettingsSchema>) {
    return this.plant.saveEnergySettings(auth, b);
  }

  @Get('condition/models')
  @RequirePermissions(R)
  models(@Auth() auth: AuthContext) {
    return this.plant.cmModels(auth);
  }

  @Put('condition/models/:id')
  @RequirePermissions(M)
  @ApiZodBody(cmModelSchema)
  saveModel(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(cmModelSchema)) b: z.infer<typeof cmModelSchema>) {
    return this.plant.saveCmModel(auth, p.id, b);
  }

  @Post('condition/models/:id/relearn')
  @HttpCode(200)
  @RequirePermissions(M)
  @ApiZodBody(cmModelSchema)
  relearn(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(cmModelSchema)) b: z.infer<typeof cmModelSchema>) {
    return this.plant.saveCmModel(auth, p.id, b, true);
  }

  @Get('condition/anomalies')
  @RequirePermissions(R)
  anomalies(@Auth() auth: AuthContext, @Query(body(z.object({ status: z.enum(['open', 'all']).default('open'), days: z.coerce.number().int().min(1).max(730).default(90) }))) q: { status: 'open' | 'all'; days: number }) {
    return this.plant.anomalies(auth, q);
  }

  @Post('condition/anomalies/:id/feedback')
  @HttpCode(200)
  @RequirePermissions(R)
  @ApiZodBody(feedbackSchema)
  feedback(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(feedbackSchema)) b: z.infer<typeof feedbackSchema>) {
    return this.plant.feedback(auth, p.id, b);
  }

  @Get('cold-chain')
  @RequirePermissions(R)
  coldChain(@Auth() auth: AuthContext) {
    return this.plant.coldChain(auth);
  }

  @Get('cold-chain/report')
  @RequirePermissions(R)
  report(@Auth() auth: AuthContext, @Query(body(rangeQuery.extend({ signalId: z.uuid(), low: z.coerce.number().optional(), high: z.coerce.number().optional() }))) q: { signalId: string; from?: string; to?: string; low?: number; high?: number }) {
    return this.plant.coldChainReport(auth, q);
  }

  @Get('cold-chain/trips/:id')
  @RequirePermissions(R, 'sales.deliveries.read')
  trip(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.plant.tripReport(auth, p.id);
  }
}
