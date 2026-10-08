import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { declarationSchema, entrySchema, eprCertSchema, EsgService, factorSchema, metricSchema, syncSchema } from './esg.service';

const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const fyPipe = new ZodValidationPipe(z.object({ fiscalYear: z.string().regex(/^\d{4}-\d{2}$/).optional() }));
const R = 'esg.reports.read';
const M = 'esg.data.manage';

@ApiTags('Sustainability')
@ApiBearerAuth()
@Controller()
export class EsgController {
  constructor(private readonly esg: EsgService) {}

  private fy(q: { fiscalYear?: string }) {
    return q.fiscalYear ?? this.esg.currentFiscalYear();
  }

  @Get('esg/factors')
  @RequirePermissions(R)
  factors(@Auth() auth: AuthContext) {
    return this.esg.factors(auth);
  }

  @Post('esg/factors')
  @HttpCode(200)
  @RequirePermissions(M)
  @ApiZodBody(factorSchema)
  saveFactor(@Auth() auth: AuthContext, @Body(body(factorSchema)) b: z.infer<typeof factorSchema>) {
    return this.esg.saveFactor(auth, b);
  }

  @Get('esg/entries')
  @RequirePermissions(R)
  entries(@Auth() auth: AuthContext, @Query(fyPipe) q: { fiscalYear?: string }) {
    return this.esg.entries(auth, this.fy(q));
  }

  @Post('esg/entries')
  @RequirePermissions(M)
  @ApiZodBody(entrySchema)
  addEntry(@Auth() auth: AuthContext, @Body(body(entrySchema)) b: z.infer<typeof entrySchema>) {
    return this.esg.addEntry(auth, b);
  }

  @Delete('esg/entries/:id')
  @RequirePermissions(M)
  deleteEntry(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.esg.deleteEntry(auth, p.id);
  }

  @Post('esg/sync')
  @HttpCode(200)
  @RequirePermissions(M)
  @ApiZodBody(syncSchema)
  sync(@Auth() auth: AuthContext, @Body(body(syncSchema)) b: z.infer<typeof syncSchema>) {
    return this.esg.sync(auth, b.period);
  }

  @Get('esg/footprint')
  @RequirePermissions(R)
  footprint(@Auth() auth: AuthContext, @Query(fyPipe) q: { fiscalYear?: string }) {
    return this.esg.footprint(auth, this.fy(q));
  }

  @Get('esg/metrics')
  @RequirePermissions(R)
  metrics(@Auth() auth: AuthContext, @Query(fyPipe) q: { fiscalYear?: string }) {
    return this.esg.metrics(auth, this.fy(q));
  }

  @Post('esg/metrics')
  @HttpCode(200)
  @RequirePermissions(M)
  @ApiZodBody(metricSchema)
  saveMetrics(@Auth() auth: AuthContext, @Body(body(metricSchema)) b: z.infer<typeof metricSchema>) {
    return this.esg.saveMetrics(auth, b);
  }

  @Get('esg/brsr')
  @RequirePermissions(R)
  brsr(@Auth() auth: AuthContext, @Query(fyPipe) q: { fiscalYear?: string }) {
    return this.esg.brsr(auth, this.fy(q));
  }

  @Get('esg/epr')
  @RequirePermissions(R)
  epr(@Auth() auth: AuthContext) {
    return this.esg.epr(auth);
  }

  @Post('esg/epr/certificates')
  @RequirePermissions(M)
  @ApiZodBody(eprCertSchema)
  addEpr(@Auth() auth: AuthContext, @Body(body(eprCertSchema)) b: z.infer<typeof eprCertSchema>) {
    return this.esg.addEprCertificate(auth, b);
  }

  @Get('compliance/materials')
  @RequirePermissions(R)
  materials(@Auth() auth: AuthContext) {
    return this.esg.materials(auth);
  }

  @Post('compliance/materials')
  @HttpCode(200)
  @RequirePermissions('compliance.materials.manage')
  @ApiZodBody(declarationSchema)
  declare(@Auth() auth: AuthContext, @Body(body(declarationSchema)) b: z.infer<typeof declarationSchema>) {
    return this.esg.saveDeclaration(auth, b);
  }
}
