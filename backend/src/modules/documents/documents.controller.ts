import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, ApiZodQuery, Auth } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ApprovalsService } from './approvals.service';
import { AttachmentsService } from './attachments.service';
import { commentSchema, decisionSchema, rejectSchema, searchSchema, type DecisionInput } from './documents.schemas';
import { DocumentsService } from './documents.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));

/**
 * Endpoints shared by every document type. Access is checked per document
 * against the type's read permission (DOC_TYPES[type].readPermission).
 */
@ApiTags('Documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly approvals: ApprovalsService,
    private readonly attachments: AttachmentsService,
  ) {}

  @Get()
  @ApiZodQuery(searchSchema)
  search(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(searchSchema)) q: z.infer<typeof searchSchema>) {
    return this.documents.search(auth, q);
  }

  /** Documents waiting for my approval. */
  @Get('approvals/inbox')
  inbox(@Auth() auth: AuthContext) {
    return this.approvals.inbox(auth);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ApiZodBody(decisionSchema)
  approve(
    @Auth() auth: AuthContext,
    @Param(idPipe) p: { id: string },
    @Body(new ZodValidationPipe(decisionSchema)) body: DecisionInput,
    @Req() req: AppRequest,
  ) {
    return this.documents.decideById(auth, p.id, 'approved', body.version, body.comment, requestMeta(req));
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiZodBody(rejectSchema)
  reject(
    @Auth() auth: AuthContext,
    @Param(idPipe) p: { id: string },
    @Body(new ZodValidationPipe(rejectSchema)) body: z.infer<typeof rejectSchema>,
    @Req() req: AppRequest,
  ) {
    return this.documents.decideById(auth, p.id, 'rejected', body.version, body.comment, requestMeta(req));
  }

  @Get(':id/activity')
  activity(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.documents.listActivity(auth, p.id);
  }

  @Post(':id/comments')
  @ApiZodBody(commentSchema)
  comment(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(commentSchema)) body: { message: string }) {
    return this.documents.addComment(auth, p.id, body.message);
  }

  @Get(':id/revisions')
  revisions(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.documents.listRevisions(auth, p.id);
  }

  // ---- Attachments ----

  @Get(':id/attachments')
  listAttachments(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.attachments.list(auth, p.id);
  }

  @Post(':id/attachments')
  @ApiConsumes('multipart/form-data')
  async upload(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    if (!req.isMultipart()) throw new BadRequestException('Send the file as multipart/form-data');
    const file = await req.file();
    if (!file) throw new BadRequestException('No file received');
    return this.attachments.upload(auth, p.id, file, requestMeta(req));
  }

  @Get('attachments/:id/download')
  async download(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    const file = await this.attachments.download(auth, p.id);
    return new StreamableFile(file.stream, {
      type: file.contentType,
      length: file.sizeBytes,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
  }

  @Delete('attachments/:id')
  @HttpCode(204)
  removeAttachment(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.attachments.remove(auth, p.id, requestMeta(req));
  }
}
