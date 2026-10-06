import { Controller, Get, Param, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Auth } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ReportsService } from './reports.service';

const keyPipe = new ZodValidationPipe(z.object({ key: z.string().regex(/^[a-z0-9-]{2,60}$/) }));
const paramsPipe = new ZodValidationPipe(z.record(z.string().regex(/^[a-zA-Z]{1,30}$/), z.string().max(80)));

/** Each report checks its own permission (sales, stock, production…), so there is no blanket guard here. */
@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  catalogue(@Auth() auth: AuthContext) {
    return this.reports.catalogue(auth);
  }

  @Get(':key')
  run(@Auth() auth: AuthContext, @Param(keyPipe) p: { key: string }, @Query(paramsPipe) q: Record<string, string>) {
    return this.reports.run(auth, p.key, q);
  }

  @Get(':key/export')
  async export(@Auth() auth: AuthContext, @Param(keyPipe) p: { key: string }, @Query(paramsPipe) q: Record<string, string>) {
    const { format, ...rest } = q;
    const f = await this.reports.export(auth, p.key, rest, format === 'csv' ? 'csv' : 'xlsx');
    return new StreamableFile(f.body, { type: f.type, length: f.body.length, disposition: `attachment; filename="${f.name}"` });
  }
}
