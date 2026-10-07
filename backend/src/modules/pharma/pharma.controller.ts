import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { aggregateSchema, ceilingSchema, commissionSchema, decommissionSchema, PharmaService, resultsSchema, settingsSchema, studySchema } from './pharma.service';

const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const R = 'pharma.reports.read';

@ApiTags('Pharma')
@ApiBearerAuth()
@Controller('pharma')
export class PharmaController {
  constructor(private readonly pharma: PharmaService) {}

  @Get('settings')
  @RequirePermissions(R)
  settings(@Auth() auth: AuthContext) {
    return this.pharma.settings(auth);
  }

  @Put('settings')
  @RequirePermissions('pharma.serials.manage')
  @ApiZodBody(settingsSchema)
  saveSettings(@Auth() auth: AuthContext, @Body(body(settingsSchema)) b: z.infer<typeof settingsSchema>) {
    return this.pharma.saveSettings(auth, b);
  }

  @Get('stability')
  @RequirePermissions(R)
  studies(@Auth() auth: AuthContext, @Query(body(z.object({ itemId: z.uuid().optional(), status: z.enum(['active', 'completed', 'cancelled']).optional() }))) q: { itemId?: string; status?: string }) {
    return this.pharma.studies(auth, q);
  }

  @Post('stability')
  @RequirePermissions('pharma.stability.manage')
  @ApiZodBody(studySchema)
  create(@Auth() auth: AuthContext, @Body(body(studySchema)) b: z.infer<typeof studySchema>) {
    return this.pharma.createStudy(auth, b);
  }

  @Get('stability/:id')
  @RequirePermissions(R)
  study(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.pharma.study(auth, p.id);
  }

  @Post('stability/:id/results')
  @HttpCode(200)
  @RequirePermissions('pharma.stability.manage')
  @ApiZodBody(resultsSchema)
  results(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(resultsSchema)) b: z.infer<typeof resultsSchema>, @Req() req: AppRequest) {
    return this.pharma.recordResults(auth, p.id, b, requestMeta(req));
  }

  @Post('stability/:id/status')
  @HttpCode(200)
  @RequirePermissions('pharma.stability.manage')
  status(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(z.object({ status: z.enum(['completed', 'cancelled']) }))) b: { status: 'completed' | 'cancelled' }) {
    return this.pharma.setStudyStatus(auth, p.id, b.status);
  }

  @Get('apqr')
  @RequirePermissions(R)
  apqr(@Auth() auth: AuthContext, @Query(body(z.object({ itemId: z.uuid(), from: z.iso.date(), to: z.iso.date() }))) q: { itemId: string; from: string; to: string }) {
    return this.pharma.apqr(auth, q.itemId, q.from, q.to);
  }

  @Post('serials/commission')
  @RequirePermissions('pharma.serials.manage')
  @ApiZodBody(commissionSchema)
  commission(@Auth() auth: AuthContext, @Body(body(commissionSchema)) b: z.infer<typeof commissionSchema>) {
    return this.pharma.commission(auth, b);
  }

  @Post('serials/aggregate')
  @RequirePermissions('pharma.serials.manage')
  @ApiZodBody(aggregateSchema)
  aggregate(@Auth() auth: AuthContext, @Body(body(aggregateSchema)) b: z.infer<typeof aggregateSchema>) {
    return this.pharma.aggregate(auth, b);
  }

  @Post('serials/decommission')
  @HttpCode(200)
  @RequirePermissions('pharma.serials.manage')
  @ApiZodBody(decommissionSchema)
  decommission(@Auth() auth: AuthContext, @Body(body(decommissionSchema)) b: z.infer<typeof decommissionSchema>) {
    return this.pharma.decommission(auth, b);
  }

  @Get('serials/lookup')
  @RequirePermissions(R)
  lookup(@Auth() auth: AuthContext, @Query(body(z.object({ code: z.string().trim().min(1).max(120) }))) q: { code: string }) {
    return this.pharma.lookup(auth, q.code);
  }

  @Get('serials/export')
  @RequirePermissions(R)
  exportBatch(@Auth() auth: AuthContext, @Query(body(z.object({ itemId: z.uuid(), batchNo: z.string().trim().min(1).max(40) }))) q: { itemId: string; batchNo: string }) {
    return this.pharma.exportBatch(auth, q.itemId, q.batchNo);
  }

  @Get('api-labels')
  @RequirePermissions(R)
  apiLabels(
    @Auth() auth: AuthContext,
    @Query(body(z.object({ itemId: z.uuid(), batchNo: z.string().trim().min(1).max(40), brandName: z.string().max(80).optional(), batchSize: z.string().max(40).optional(), storage: z.string().max(120).optional(), retestDate: z.iso.date().optional(), containers: z.coerce.number().int().min(1).max(500).default(1) })))
    q: { itemId: string; batchNo: string; brandName?: string; batchSize?: string; storage?: string; retestDate?: string; containers: number },
  ) {
    return this.pharma.apiLabels(auth, q);
  }

  @Get('dpco/ceilings')
  @RequirePermissions(R)
  ceilings(@Auth() auth: AuthContext) {
    return this.pharma.ceilings(auth);
  }

  @Post('dpco/ceilings')
  @RequirePermissions('pharma.pricing.manage')
  @ApiZodBody(ceilingSchema)
  addCeiling(@Auth() auth: AuthContext, @Body(body(ceilingSchema)) b: z.infer<typeof ceilingSchema>) {
    return this.pharma.addCeiling(auth, b);
  }

  @Get('dpco/check')
  @RequirePermissions(R)
  check(@Auth() auth: AuthContext, @Query(body(z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }))) q: { from?: string; to?: string }) {
    return this.pharma.dpcoCheck(auth, q);
  }
}
