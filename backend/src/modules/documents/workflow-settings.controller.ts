import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ALL_DOC_TYPES, DOC_TYPES } from '@nextgen/database';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, ApiZodQuery, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ApprovalsService } from './approvals.service';
import {
  approvalRuleSchema,
  createSeriesSchema,
  listSeriesSchema,
  previewSeriesSchema,
  updateSeriesSchema,
  type ApprovalRuleInput,
  type CreateSeriesInput,
  type PreviewSeriesInput,
  type UpdateSeriesInput,
} from './documents.schemas';
import { PATTERN_TOKENS } from './numbering';
import { NumberingService } from './numbering.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));

@ApiTags('Workflow settings')
@ApiBearerAuth()
@Controller('platform')
export class WorkflowSettingsController {
  constructor(
    private readonly numbering: NumberingService,
    private readonly approvals: ApprovalsService,
  ) {}

  /** Registered document types (for settings dropdowns). */
  @Get('document-types')
  docTypes() {
    return ALL_DOC_TYPES.map((value) => ({ value, ...DOC_TYPES[value] }));
  }

  // ---- Number series ----

  @Get('number-series')
  @RequirePermissions('platform.numbering.manage')
  @ApiZodQuery(listSeriesSchema)
  listSeries(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(listSeriesSchema)) q: { docType?: string }) {
    return this.numbering.list(auth, q.docType);
  }

  @Post('number-series/preview')
  @HttpCode(200)
  @RequirePermissions('platform.numbering.manage')
  @ApiZodBody(previewSeriesSchema)
  preview(@Body(new ZodValidationPipe(previewSeriesSchema)) body: PreviewSeriesInput) {
    return { ...this.numbering.preview(body), tokens: PATTERN_TOKENS };
  }

  @Post('number-series')
  @RequirePermissions('platform.numbering.manage')
  @ApiZodBody(createSeriesSchema)
  createSeries(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createSeriesSchema)) body: CreateSeriesInput, @Req() req: AppRequest) {
    return this.numbering.create(auth, body, requestMeta(req));
  }

  @Patch('number-series/:id')
  @RequirePermissions('platform.numbering.manage')
  @ApiZodBody(updateSeriesSchema)
  updateSeries(
    @Auth() auth: AuthContext,
    @Param(idPipe) p: { id: string },
    @Body(new ZodValidationPipe(updateSeriesSchema)) body: UpdateSeriesInput,
    @Req() req: AppRequest,
  ) {
    return this.numbering.update(auth, p.id, body, requestMeta(req));
  }

  // ---- Approval rules ----

  @Get('approval-rules')
  @RequirePermissions('platform.workflows.manage')
  listRules(@Auth() auth: AuthContext) {
    return this.approvals.listRules(auth);
  }

  @Post('approval-rules')
  @RequirePermissions('platform.workflows.manage')
  @ApiZodBody(approvalRuleSchema)
  createRule(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(approvalRuleSchema)) body: ApprovalRuleInput, @Req() req: AppRequest) {
    return this.approvals.saveRule(auth, null, body, requestMeta(req));
  }

  @Put('approval-rules/:id')
  @RequirePermissions('platform.workflows.manage')
  @ApiZodBody(approvalRuleSchema)
  updateRule(
    @Auth() auth: AuthContext,
    @Param(idPipe) p: { id: string },
    @Body(new ZodValidationPipe(approvalRuleSchema)) body: ApprovalRuleInput,
    @Req() req: AppRequest,
  ) {
    return this.approvals.saveRule(auth, p.id, body, requestMeta(req));
  }

  @Delete('approval-rules/:id')
  @HttpCode(204)
  @RequirePermissions('platform.workflows.manage')
  deleteRule(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.approvals.deleteRule(auth, p.id, requestMeta(req));
  }
}
