import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { Auth, RequirePermissions } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AiGateway } from '../ai-gov/ai-gateway.service';
import { DocAiService, textSchema } from '../docai/docai.service';
import type { DocKind } from '../docai/extractors';
import { PredictService } from './predict.service';

const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const DOC_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv'];

@ApiTags('AI insights')
@ApiBearerAuth()
@Controller('insights')
export class PredictController {
  constructor(
    private readonly predict: PredictService,
    private readonly gateway: AiGateway,
  ) {}

  @Get('collections')
  @RequirePermissions('ai.insights.read', 'sales.invoices.read')
  async collections(@Auth() auth: AuthContext, @Query(body(z.object({ weeks: z.coerce.number().int().min(1).max(26).default(8) }))) q: { weeks: number }) {
    await this.gateway.assertEnabled(auth.tenantId, 'insights');
    return this.predict.collections(auth, q.weeks);
  }

  @Get('prices')
  @RequirePermissions('ai.insights.read', 'purchase.orders.read')
  async prices(@Auth() auth: AuthContext, @Query(body(z.object({ itemId: z.uuid().optional(), horizon: z.coerce.number().int().min(1).max(12).default(3) }))) q: { itemId?: string; horizon: number }) {
    await this.gateway.assertEnabled(auth.tenantId, 'insights');
    return this.predict.prices(auth, q.itemId, q.horizon);
  }

  @Post('why')
  @HttpCode(200)
  @RequirePermissions('ai.insights.read', 'sales.invoices.read')
  async why(@Auth() auth: AuthContext, @Body(body(z.object({ question: z.string().trim().min(3).max(300) }))) b: { question: string }) {
    await this.gateway.assertEnabled(auth.tenantId, 'insights');
    return this.predict.why(auth, b.question);
  }
}

@ApiTags('Document AI')
@ApiBearerAuth()
@Controller('docai')
export class DocAiController {
  constructor(private readonly docai: DocAiService) {}

  @Post('read-text')
  @RequirePermissions('ai.documents.use')
  readText(@Auth() auth: AuthContext, @Body(body(textSchema)) b: z.infer<typeof textSchema>) {
    return this.docai.read(auth, { text: b.text, kind: b.kind as DocKind | undefined, fileName: b.fileName });
  }

  @Post('read-file')
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('ai.documents.use')
  async readFile(@Auth() auth: AuthContext, @Req() req: AppRequest) {
    if (!req.isMultipart()) throw new BadRequestException('Send the document as multipart/form-data');
    const file = await req.file();
    if (!file) throw new BadRequestException('No file received');
    const buffer = await file.toBuffer();
    if (file.file.truncated || buffer.length > 10 * 1024 * 1024) throw new BadRequestException('Documents up to 10 MB can be read');
    const mimeType = file.mimetype === 'application/octet-stream' && /\.(txt|csv)$/i.test(file.filename) ? 'text/plain' : file.mimetype;
    if (!DOC_TYPES.includes(mimeType)) throw new BadRequestException('Upload a PDF, image, or text file');
    const kind = (file.fields?.kind as { value?: string } | undefined)?.value;
    return this.docai.read(auth, { file: { buffer, mimeType, name: file.filename || 'document' }, kind: kind as DocKind | undefined });
  }

  @Get('captures')
  @RequirePermissions('ai.documents.use')
  list(@Auth() auth: AuthContext, @Query(body(z.object({ status: z.enum(['review', 'applied', 'discarded']).optional() }))) q: { status?: string }) {
    return this.docai.list(auth, q.status);
  }

  @Get('captures/:id')
  @RequirePermissions('ai.documents.use')
  get(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.docai.get(auth, p.id);
  }

  @Post('captures/:id/apply')
  @HttpCode(200)
  @RequirePermissions('ai.documents.use')
  apply(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.docai.apply(auth, p.id);
  }

  @Post('captures/:id/discard')
  @HttpCode(200)
  @RequirePermissions('ai.documents.use')
  discard(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.docai.discard(auth, p.id);
  }
}
