import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { cancelSchema, versionSchema, type CancelInput } from '../documents/documents.schemas';
import { BillsOfEntryService, createBoeSchema, updateBoeSchema, type CreateBoeInput } from './bills-of-entry.service';
import { BillCaptureService } from './capture/bill-capture.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const versionQuery = new ZodValidationPipe(z.object({ version: z.coerce.number().int() }));
const listPipe = new ZodValidationPipe(
  z.object({
    status: z.string().optional(),
    q: z.string().trim().max(60).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.uuid().optional(),
  }),
);

const BILL_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain'];

/** Imports (Bills of Entry) and capture of supplier bills from a file. */
@ApiTags('Purchase invoices')
@ApiBearerAuth()
@Controller('purchase')
export class ImportsTradeController {
  constructor(
    private readonly boe: BillsOfEntryService,
    private readonly capture: BillCaptureService,
  ) {}

  // ---- Bill capture (OCR / AI) ----

  @Get('invoices/capture/status')
  @RequirePermissions('purchase.invoices.manage')
  captureStatus() {
    return { ai: this.capture.aiEnabled, accepts: this.capture.aiEnabled ? BILL_TYPES : ['text/plain'] };
  }

  @Post('invoices/capture')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('purchase.invoices.manage')
  async captureBill(@Auth() auth: AuthContext, @Req() req: AppRequest) {
    if (!req.isMultipart()) throw new BadRequestException('Send the bill as multipart/form-data');
    const file = await req.file();
    if (!file) throw new BadRequestException('No file received');
    const buffer = await file.toBuffer();
    if (file.file.truncated || buffer.length > 10 * 1024 * 1024) throw new BadRequestException('Bills up to 10 MB can be read');
    const mimeType = file.mimetype === 'application/octet-stream' && /\.txt$/i.test(file.filename) ? 'text/plain' : file.mimetype;
    if (!BILL_TYPES.includes(mimeType)) throw new BadRequestException('Upload a PDF, PNG, JPEG, WebP or text bill');
    return this.capture.capture(auth, { buffer, fileName: file.filename || 'bill', mimeType });
  }

  // ---- Bills of Entry ----

  @Get('bills-of-entry')
  @RequirePermissions('purchase.invoices.read')
  list(@Auth() auth: AuthContext, @Query(listPipe) q: { status?: string; q?: string; limit: number; cursor?: string }) {
    return this.boe.list(auth, q);
  }
  @Get('bills-of-entry/:id')
  @RequirePermissions('purchase.invoices.read')
  get(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.boe.get(auth, p.id);
  }
  @Post('bills-of-entry/preview')
  @HttpCode(200)
  @RequirePermissions('purchase.invoices.read')
  @ApiZodBody(createBoeSchema)
  preview(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createBoeSchema)) body: CreateBoeInput) {
    return this.boe.preview(auth, body);
  }
  @Post('bills-of-entry')
  @RequirePermissions('purchase.invoices.manage')
  @ApiZodBody(createBoeSchema)
  create(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createBoeSchema)) body: CreateBoeInput, @Req() req: AppRequest) {
    return this.boe.create(auth, body, requestMeta(req));
  }
  @Put('bills-of-entry/:id')
  @RequirePermissions('purchase.invoices.manage')
  @ApiZodBody(updateBoeSchema)
  update(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateBoeSchema)) body: z.infer<typeof updateBoeSchema>, @Req() req: AppRequest) {
    return this.boe.update(auth, p.id, body, requestMeta(req));
  }
  @Delete('bills-of-entry/:id')
  @HttpCode(204)
  @RequirePermissions('purchase.invoices.manage')
  remove(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.boe.remove(auth, p.id, q.version, requestMeta(req));
  }
  @Post('bills-of-entry/:id/submit')
  @HttpCode(200)
  @RequirePermissions('purchase.invoices.manage')
  submit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(versionSchema)) b: { version: number }, @Req() req: AppRequest) {
    return this.boe.submit(auth, p.id, b.version, requestMeta(req));
  }
  @Post('bills-of-entry/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('purchase.invoices.cancel')
  cancel(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(cancelSchema)) b: CancelInput, @Req() req: AppRequest) {
    return this.boe.cancel(auth, p.id, b.version, b.reason, requestMeta(req));
  }
}
