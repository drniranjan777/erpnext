import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, ApiZodQuery, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import {
  customFieldSchema,
  CustomFieldsService,
  updateCustomFieldSchema,
  type CustomFieldInput,
  type UpdateCustomFieldInput,
} from './custom-fields.service';
import { printFormatSchema, PrintService, updatePrintFormatSchema, type PrintFormatInput, type UpdatePrintFormatInput } from './print.service';
import { savedViewSchema, SavedViewsService, type SavedViewInput } from './saved-views.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const entityQuery = z.object({ entity: z.string().max(60).optional(), activeOnly: z.enum(['true', 'false']).optional() });
const docTypeQuery = z.object({ docType: z.string().max(60).optional() });
const previewSchema = z.object({
  docType: z.string().max(60),
  template: z.string().max(100_000),
  css: z.string().max(50_000).default(''),
  documentId: z.uuid().optional(),
});

@ApiTags('Customisation')
@ApiBearerAuth()
@Controller()
export class CustomizationController {
  constructor(
    private readonly fields: CustomFieldsService,
    private readonly print: PrintService,
    private readonly views: SavedViewsService,
  ) {}

  // ---- Custom fields (definitions are readable by everyone: forms need them) ----

  @Get('platform/custom-fields/entities')
  entities() {
    return this.fields.entities();
  }

  @Get('platform/custom-fields')
  @ApiZodQuery(entityQuery)
  listFields(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(entityQuery)) q: z.infer<typeof entityQuery>) {
    return this.fields.list(auth, q.entity, q.activeOnly === 'true');
  }

  @Post('platform/custom-fields')
  @RequirePermissions('platform.customization.manage')
  @ApiZodBody(customFieldSchema)
  createField(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(customFieldSchema)) body: CustomFieldInput, @Req() req: AppRequest) {
    return this.fields.create(auth, body, requestMeta(req));
  }

  @Patch('platform/custom-fields/:id')
  @RequirePermissions('platform.customization.manage')
  @ApiZodBody(updateCustomFieldSchema)
  updateField(
    @Auth() auth: AuthContext,
    @Param(idPipe) p: { id: string },
    @Body(new ZodValidationPipe(updateCustomFieldSchema)) body: UpdateCustomFieldInput,
    @Req() req: AppRequest,
  ) {
    return this.fields.update(auth, p.id, body, requestMeta(req));
  }

  // ---- Print ----

  /** Rendered HTML for printing a document (any user who can read it). */
  @Get('documents/:id/print')
  @ApiZodQuery(z.object({ formatId: z.uuid().optional() }))
  renderDocument(
    @Auth() auth: AuthContext,
    @Param(idPipe) p: { id: string },
    @Query(new ZodValidationPipe(z.object({ formatId: z.uuid().optional() }))) q: { formatId?: string },
  ) {
    return this.print.renderDocument(auth, p.id, q.formatId);
  }

  @Get('platform/print-formats')
  @RequirePermissions('platform.customization.manage')
  @ApiZodQuery(docTypeQuery)
  listFormats(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(docTypeQuery)) q: { docType?: string }) {
    return this.print.list(auth, q.docType);
  }

  @Get('platform/print-formats/built-in')
  @RequirePermissions('platform.customization.manage')
  @ApiZodQuery(docTypeQuery)
  builtIn(@Query(new ZodValidationPipe(docTypeQuery)) q: { docType?: string }) {
    return this.print.builtIn(q.docType ?? 'purchase_requisition');
  }

  @Post('platform/print-formats/preview')
  @HttpCode(200)
  @RequirePermissions('platform.customization.manage')
  @ApiZodBody(previewSchema)
  preview(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(previewSchema)) body: z.infer<typeof previewSchema>) {
    return this.print.preview(auth, body);
  }

  @Post('platform/print-formats')
  @RequirePermissions('platform.customization.manage')
  @ApiZodBody(printFormatSchema)
  createFormat(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(printFormatSchema)) body: PrintFormatInput, @Req() req: AppRequest) {
    return this.print.create(auth, body, requestMeta(req));
  }

  @Patch('platform/print-formats/:id')
  @RequirePermissions('platform.customization.manage')
  @ApiZodBody(updatePrintFormatSchema)
  updateFormat(
    @Auth() auth: AuthContext,
    @Param(idPipe) p: { id: string },
    @Body(new ZodValidationPipe(updatePrintFormatSchema)) body: UpdatePrintFormatInput,
    @Req() req: AppRequest,
  ) {
    return this.print.update(auth, p.id, body, requestMeta(req));
  }

  @Delete('platform/print-formats/:id')
  @HttpCode(204)
  @RequirePermissions('platform.customization.manage')
  deleteFormat(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.print.remove(auth, p.id, requestMeta(req));
  }

  // ---- Saved views (personal) ----

  @Get('saved-views')
  @ApiZodQuery(z.object({ entity: z.string() }))
  listViews(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ entity: z.string().min(2).max(60) }))) q: { entity: string }) {
    return this.views.list(auth, q.entity);
  }

  @Post('saved-views')
  @ApiZodBody(savedViewSchema)
  createView(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(savedViewSchema)) body: SavedViewInput) {
    return this.views.create(auth, body);
  }

  @Delete('saved-views/:id')
  @HttpCode(204)
  deleteView(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.views.remove(auth, p.id);
  }
}
