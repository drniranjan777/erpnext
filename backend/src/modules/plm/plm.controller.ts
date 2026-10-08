import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DocStoreService, fileSchema, folderSchema, holdSchema, searchSchema, signSchema } from './docstore.service';
import { cadSchema, ebomSchema, moveSchema, PlmService, releaseSchema } from './plm.service';

const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const noteQuery = new ZodValidationPipe(z.object({ note: z.string().trim().max(300).optional() }));
const disposition = (name: string) => `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;

async function fileOf(req: AppRequest) {
  if (!req.isMultipart()) throw new BadRequestException('Send the file as multipart/form-data');
  const file = await req.file();
  if (!file) throw new BadRequestException('No file received');
  return file;
}

@ApiTags('PLM')
@ApiBearerAuth()
@Controller('plm')
export class PlmController {
  constructor(private readonly plm: PlmService) {}

  @Get('items')
  @RequirePermissions('plm.data.read')
  states(@Auth() auth: AuthContext) {
    return this.plm.states(auth);
  }

  @Post('items/move')
  @HttpCode(200)
  @RequirePermissions('plm.items.manage')
  @ApiZodBody(moveSchema)
  move(@Auth() auth: AuthContext, @Body(body(moveSchema)) b: z.infer<typeof moveSchema>, @Req() req: AppRequest) {
    return this.plm.move(auth, b, requestMeta(req));
  }

  @Get('eboms')
  @RequirePermissions('plm.data.read')
  eboms(@Auth() auth: AuthContext, @Query(body(z.object({ itemId: z.uuid().optional() }))) q: { itemId?: string }) {
    return this.plm.eboms(auth, q.itemId);
  }

  @Post('eboms')
  @HttpCode(200)
  @RequirePermissions('plm.items.manage')
  @ApiZodBody(ebomSchema)
  saveEbom(@Auth() auth: AuthContext, @Body(body(ebomSchema)) b: z.infer<typeof ebomSchema>) {
    return this.plm.saveEbom(auth, b);
  }

  @Get('eboms/:id')
  @RequirePermissions('plm.data.read')
  ebom(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.plm.getEbom(auth, p.id);
  }

  @Post('eboms/:id/release')
  @HttpCode(200)
  @RequirePermissions('plm.items.manage')
  @ApiZodBody(releaseSchema)
  releaseEbom(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(releaseSchema)) b: z.infer<typeof releaseSchema>, @Req() req: AppRequest) {
    return this.plm.releaseEbom(auth, p.id, b, requestMeta(req));
  }

  @Post('eboms/:id/mbom')
  @HttpCode(200)
  @RequirePermissions('plm.items.manage')
  toMbom(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.plm.toMbom(auth, p.id, requestMeta(req));
  }

  @Get('cad')
  @RequirePermissions('plm.data.read')
  cad(@Auth() auth: AuthContext, @Query(body(z.object({ q: z.string().trim().max(60).optional() }))) q: { q?: string }) {
    return this.plm.cadList(auth, q.q);
  }

  @Post('cad')
  @RequirePermissions('plm.cad.manage')
  @ApiZodBody(cadSchema)
  createCad(@Auth() auth: AuthContext, @Body(body(cadSchema)) b: z.infer<typeof cadSchema>) {
    return this.plm.createCad(auth, b);
  }

  @Get('cad/:id')
  @RequirePermissions('plm.data.read')
  getCad(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.plm.getCad(auth, p.id);
  }

  @Post('cad/:id/check-out')
  @HttpCode(200)
  @RequirePermissions('plm.cad.manage')
  checkOut(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.plm.checkOut(auth, p.id);
  }

  @Post('cad/:id/undo-check-out')
  @HttpCode(200)
  @RequirePermissions('plm.cad.manage')
  undo(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.plm.undoCheckOut(auth, p.id);
  }

  @Post('cad/:id/check-in')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('plm.cad.manage')
  async checkIn(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(noteQuery) q: { note?: string }, @Req() req: AppRequest) {
    return this.plm.checkIn(auth, p.id, await fileOf(req), q.note ?? null);
  }

  @Post('cad/:id/release')
  @HttpCode(200)
  @RequirePermissions('plm.cad.manage')
  @ApiZodBody(releaseSchema)
  releaseCad(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(releaseSchema)) b: z.infer<typeof releaseSchema>, @Req() req: AppRequest) {
    return this.plm.releaseCad(auth, p.id, b, requestMeta(req));
  }

  @Get('cad/versions/:id/download')
  @RequirePermissions('plm.data.read')
  async downloadCad(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    const f = await this.plm.downloadCad(auth, p.id);
    return new StreamableFile(f.stream, { type: 'application/octet-stream', length: f.sizeBytes, disposition: disposition(f.fileName) });
  }
}

@ApiTags('Document management')
@ApiBearerAuth()
@Controller('doc-store')
export class DocStoreController {
  constructor(private readonly store: DocStoreService) {}

  @Get('folders')
  @RequirePermissions('docs.files.read')
  folders(@Auth() auth: AuthContext) {
    return this.store.folders(auth);
  }

  @Post('folders')
  @RequirePermissions('docs.files.manage')
  @ApiZodBody(folderSchema)
  folder(@Auth() auth: AuthContext, @Body(body(folderSchema)) b: z.infer<typeof folderSchema>) {
    return this.store.createFolder(auth, b);
  }

  @Get('files')
  @RequirePermissions('docs.files.read')
  search(@Auth() auth: AuthContext, @Query(body(searchSchema)) q: z.infer<typeof searchSchema>) {
    return this.store.search(auth, q);
  }

  @Post('files')
  @RequirePermissions('docs.files.manage')
  @ApiZodBody(fileSchema)
  create(@Auth() auth: AuthContext, @Body(body(fileSchema)) b: z.infer<typeof fileSchema>) {
    return this.store.createFile(auth, b);
  }

  @Get('disposal-due')
  @RequirePermissions('docs.files.manage')
  due(@Auth() auth: AuthContext) {
    return this.store.disposalDue(auth);
  }

  @Get('files/:id')
  @RequirePermissions('docs.files.read')
  get(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.store.get(auth, p.id);
  }

  @Post('files/:id/versions')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('docs.files.manage')
  async version(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(noteQuery) q: { note?: string }, @Req() req: AppRequest) {
    return this.store.addVersion(auth, p.id, await fileOf(req), q.note ?? null);
  }

  @Post('files/:id/hold')
  @HttpCode(200)
  @RequirePermissions('docs.files.manage')
  @ApiZodBody(holdSchema)
  hold(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(holdSchema)) b: z.infer<typeof holdSchema>) {
    return this.store.hold(auth, p.id, b);
  }

  @Post('files/:id/dispose')
  @HttpCode(200)
  @RequirePermissions('docs.files.manage')
  dispose(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.store.dispose(auth, p.id);
  }

  @Get('versions/:id/download')
  @RequirePermissions('docs.files.read')
  async download(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    const f = await this.store.download(auth, p.id);
    return new StreamableFile(f.stream, { type: f.contentType, length: f.sizeBytes, disposition: disposition(f.fileName) });
  }

  @Post('versions/:id/sign')
  @HttpCode(200)
  @RequirePermissions('docs.files.sign')
  @ApiZodBody(signSchema)
  sign(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(signSchema)) b: z.infer<typeof signSchema>, @Req() req: AppRequest) {
    return this.store.sign(auth, p.id, b, requestMeta(req));
  }

  @Get('versions/:id/verify')
  @RequirePermissions('docs.files.read')
  verify(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.store.verify(auth, p.id);
  }
}
