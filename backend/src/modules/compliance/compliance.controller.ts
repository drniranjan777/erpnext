import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { companies } from '@nextgen/database';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { ApiZodBody, ApiZodQuery, Auth, RequirePermissions } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DatabaseService } from '../../database/database.service';
import {
  bulkIrnSchema,
  einvoiceListSchema,
  ewbCancelSchema,
  ewbConsolidateSchema,
  ewbCreateSchema,
  ewbExtendSchema,
  ewbListSchema,
  ewbPartBSchema,
  gstPeriodSchema,
  gstSettingsSchema,
  irnCancelSchema,
} from './compliance.schemas';
import { EInvoiceService } from './einvoice.service';
import { EwayBillService } from './eway-bill.service';
import { GstReportsService } from './gst-reports.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const csv = (text: string, name: string) => {
  const body = Buffer.from(text, 'utf8');
  return new StreamableFile(body, { type: 'text/csv; charset=utf-8', length: body.length, disposition: `attachment; filename="${name}"` });
};

@ApiTags('GST compliance')
@ApiBearerAuth()
@Controller('gst')
export class ComplianceController {
  constructor(
    private readonly database: DatabaseService,
    private readonly einvoice: EInvoiceService,
    private readonly ewb: EwayBillService,
    private readonly reports: GstReportsService,
  ) {}

  // ---- Settings ----

  @Get('settings/:id')
  @RequirePermissions('gst.reports.read')
  settings(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.database.run(auth, (tx) => this.einvoice.settings(tx, p.id));
  }

  @Put('settings/:id')
  @RequirePermissions('gst.settings.manage')
  @ApiZodBody(gstSettingsSchema)
  updateSettings(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(gstSettingsSchema)) body: z.infer<typeof gstSettingsSchema>) {
    return this.database.run(auth, async (tx) => {
      const [row] = await tx
        .update(companies)
        .set({ gstSettings: { einvoice: body.einvoice, autoIrn: body.einvoice && body.autoIrn, ewayThreshold: body.ewayThreshold }, updatedBy: auth.userId })
        .where(eq(companies.id, p.id))
        .returning({ id: companies.id });
      if (!row) throw new NotFoundException('Company not found');
      return this.einvoice.settings(tx, p.id);
    });
  }

  // ---- e-Invoice ----

  @Get('einvoices')
  @RequirePermissions('gst.reports.read')
  @ApiZodQuery(einvoiceListSchema)
  listEinvoices(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(einvoiceListSchema)) q: z.infer<typeof einvoiceListSchema>) {
    return this.einvoice.list(auth, q);
  }

  @Post('einvoices/bulk')
  @HttpCode(200)
  @RequirePermissions('gst.einvoice.manage')
  @ApiZodBody(bulkIrnSchema)
  bulk(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(bulkIrnSchema)) body: z.infer<typeof bulkIrnSchema>) {
    return this.einvoice.bulk(auth, body.ids);
  }

  @Get('einvoice/:id')
  @RequirePermissions('sales.invoices.read')
  einvoiceStatus(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.einvoice.status(auth, p.id);
  }

  @Get('einvoice/:id/preview')
  @RequirePermissions('gst.einvoice.manage')
  einvoicePreview(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.einvoice.preview(auth, p.id);
  }

  @Post('einvoice/:id/generate')
  @HttpCode(200)
  @RequirePermissions('gst.einvoice.manage')
  generate(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.einvoice.generate(auth, p.id);
  }

  @Post('einvoice/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('gst.einvoice.manage')
  @ApiZodBody(irnCancelSchema)
  cancelIrn(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(irnCancelSchema)) body: z.infer<typeof irnCancelSchema>) {
    return this.einvoice.cancel(auth, p.id, body.reasonCode, body.remark);
  }

  // ---- e-Way bill ----

  @Get('eway-bills')
  @RequirePermissions('gst.reports.read')
  @ApiZodQuery(ewbListSchema)
  listEwb(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(ewbListSchema)) q: z.infer<typeof ewbListSchema>) {
    return this.ewb.list(auth, q);
  }

  @Get('eway-bills/for/:id')
  @RequirePermissions('gst.einvoice.manage')
  ewbDraft(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.ewb.draft(auth, p.id);
  }

  @Post('eway-bills')
  @RequirePermissions('gst.einvoice.manage')
  @ApiZodBody(ewbCreateSchema)
  createEwb(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(ewbCreateSchema)) body: z.infer<typeof ewbCreateSchema>) {
    const { documentId, ...input } = body;
    return this.ewb.generate(auth, documentId, input);
  }

  @Post('eway-bills/consolidate')
  @HttpCode(200)
  @RequirePermissions('gst.einvoice.manage')
  @ApiZodBody(ewbConsolidateSchema)
  consolidate(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(ewbConsolidateSchema)) body: z.infer<typeof ewbConsolidateSchema>) {
    return this.ewb.consolidate(auth, body);
  }

  @Post('eway-bills/:id/part-b')
  @HttpCode(200)
  @RequirePermissions('gst.einvoice.manage')
  @ApiZodBody(ewbPartBSchema)
  partB(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(ewbPartBSchema)) body: z.infer<typeof ewbPartBSchema>) {
    return this.ewb.updatePartB(auth, p.id, { ...body, remark: body.remark ?? undefined });
  }

  @Post('eway-bills/:id/extend')
  @HttpCode(200)
  @RequirePermissions('gst.einvoice.manage')
  @ApiZodBody(ewbExtendSchema)
  extend(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(ewbExtendSchema)) body: z.infer<typeof ewbExtendSchema>) {
    return this.ewb.extend(auth, p.id, body);
  }

  @Post('eway-bills/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('gst.einvoice.manage')
  @ApiZodBody(ewbCancelSchema)
  cancelEwb(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(ewbCancelSchema)) body: z.infer<typeof ewbCancelSchema>) {
    return this.ewb.cancel(auth, p.id, body);
  }

  // ---- Reports ----

  @Get('hsn-summary')
  @RequirePermissions('gst.reports.read')
  @ApiZodQuery(gstPeriodSchema)
  async hsn(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(gstPeriodSchema)) q: z.infer<typeof gstPeriodSchema>) {
    const data = await this.reports.hsnSummary(auth, q);
    return q.format === 'csv' ? csv(this.reports.hsnCsv(data), `HSN_summary_${q.from}_${q.to}.csv`) : data;
  }

  @Get('documents-issued')
  @RequirePermissions('gst.reports.read')
  @ApiZodQuery(gstPeriodSchema)
  documentsIssued(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(gstPeriodSchema)) q: z.infer<typeof gstPeriodSchema>) {
    return this.reports.documentsIssued(auth, q);
  }
}
