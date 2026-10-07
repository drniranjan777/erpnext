import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { todayIST } from '../../common/fiscal-year';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { createEmployeeSchema, EmployeesService, exitSchema, letterSchema, moveSchema, templateSchema, updateEmployeeSchema, type EmployeeInput } from './employees.service';
import { departmentSchema, designationSchema, gradeSchema, locationSchema, OrgService } from './org.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const docParams = new ZodValidationPipe(z.object({ id: z.uuid(), docId: z.uuid() }));
const R = 'hr.employees.read';
const W = 'hr.employees.manage';
const ORG: Record<'departments' | 'grades' | 'designations' | 'locations', z.ZodType> = { departments: departmentSchema, grades: gradeSchema, designations: designationSchema, locations: locationSchema };

@ApiTags('HR')
@ApiBearerAuth()
@Controller('hr')
export class HrController {
  constructor(
    private readonly org: OrgService,
    private readonly employees: EmployeesService,
  ) {}

  // ---- organisation masters ---------------------------------------------------------------
  @Get('org/:kind')
  @RequirePermissions(R)
  listOrg(@Auth() auth: AuthContext, @Param(new ZodValidationPipe(z.object({ kind: z.enum(['departments', 'grades', 'designations', 'locations']) }))) p: { kind: 'departments' | 'grades' | 'designations' | 'locations' }) {
    return this.org.list(auth, p.kind);
  }
  @Post('org/:kind')
  @RequirePermissions('hr.masters.manage')
  addOrg(@Auth() auth: AuthContext, @Param(new ZodValidationPipe(z.object({ kind: z.enum(['departments', 'grades', 'designations', 'locations']) }))) p: { kind: 'departments' | 'grades' | 'designations' | 'locations' }, @Body() b: unknown) {
    return this.org.save(auth, p.kind, null, this.parse(ORG[p.kind], b));
  }
  @Put('org/:kind/:id')
  @RequirePermissions('hr.masters.manage')
  updateOrg(@Auth() auth: AuthContext, @Param(new ZodValidationPipe(z.object({ kind: z.enum(['departments', 'grades', 'designations', 'locations']), id: z.uuid() }))) p: { kind: 'departments' | 'grades' | 'designations' | 'locations'; id: string }, @Body() b: unknown) {
    return this.org.save(auth, p.kind, p.id, this.parse(ORG[p.kind], b));
  }
  @Get('org-chart')
  @RequirePermissions(R)
  chart(@Auth() auth: AuthContext) {
    return this.org.chart(auth);
  }
  @Get('headcount')
  @RequirePermissions(R)
  headcount(@Auth() auth: AuthContext) {
    return this.org.headcount(auth);
  }

  // ---- employees --------------------------------------------------------------------------
  @Get('employees')
  @RequirePermissions(R)
  list(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ status: z.enum(['active', 'notice', 'exited']).optional(), departmentId: z.uuid().optional(), locationId: z.uuid().optional(), q: z.string().trim().max(60).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }))) q: { status?: string; departmentId?: string; locationId?: string; q?: string; limit: number; offset: number }) {
    return this.employees.list(auth, q);
  }
  @Get('employees/search')
  @RequirePermissions(R)
  search(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ q: z.string().trim().max(60).default('') }))) q: { q: string }) {
    return this.employees.search(auth, q.q);
  }
  @Get('employees/:id')
  @RequirePermissions(R)
  get(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.employees.get(auth, p.id);
  }
  @Post('employees')
  @RequirePermissions(W)
  @ApiZodBody(createEmployeeSchema)
  create(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createEmployeeSchema)) b: EmployeeInput, @Req() req: AppRequest) {
    return this.employees.create(auth, b, requestMeta(req));
  }
  @Put('employees/:id')
  @RequirePermissions(W)
  @ApiZodBody(updateEmployeeSchema)
  update(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateEmployeeSchema)) b: z.infer<typeof updateEmployeeSchema>, @Req() req: AppRequest) {
    return this.employees.update(auth, p.id, b, requestMeta(req));
  }
  @Post('employees/:id/move')
  @HttpCode(200)
  @RequirePermissions(W)
  @ApiZodBody(moveSchema)
  move(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(moveSchema)) b: z.infer<typeof moveSchema>) {
    return this.employees.move(auth, p.id, b);
  }
  @Post('employees/:id/confirm')
  @HttpCode(200)
  @RequirePermissions(W)
  confirm(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(z.object({ effectiveDate: z.iso.date().optional() }))) b: { effectiveDate?: string }) {
    return this.employees.confirm(auth, p.id, b.effectiveDate ?? todayIST());
  }
  @Post('employees/:id/exit')
  @HttpCode(200)
  @RequirePermissions(W)
  @ApiZodBody(exitSchema)
  exit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(exitSchema)) b: z.infer<typeof exitSchema>) {
    return this.employees.exit(auth, p.id, b);
  }
  @Post('employees/:id/reveal')
  @HttpCode(200)
  @RequirePermissions(R)
  reveal(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(z.object({ field: z.enum(['pan', 'aadhaar', 'bankAccount']) }))) b: { field: 'pan' | 'aadhaar' | 'bankAccount' }, @Req() req: AppRequest) {
    return this.employees.reveal(auth, p.id, b.field, requestMeta(req));
  }

  // ---- documents --------------------------------------------------------------------------
  /** multipart/form-data: file, plus fields kind, title, expiryDate. */
  @Post('employees/:id/documents')
  @RequirePermissions(W)
  @ApiConsumes('multipart/form-data')
  async upload(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    if (!req.isMultipart()) throw new BadRequestException('Send the file as multipart/form-data');
    const file = await req.file();
    if (!file) throw new BadRequestException('No file received');
    const field = (name: string) => {
      const f = file.fields[name] as { value?: unknown } | undefined;
      return typeof f?.value === 'string' ? f.value : null;
    };
    const expiry = field('expiryDate');
    if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) throw new BadRequestException('Expiry date as YYYY-MM-DD');
    return this.employees.upload(auth, p.id, field('kind') ?? 'other', field('title') ?? '', expiry || null, file);
  }
  @Get('employees/:id/documents/:docId')
  @RequirePermissions(R)
  async download(@Auth() auth: AuthContext, @Param(docParams) p: { id: string; docId: string }) {
    const f = await this.employees.download(auth, p.id, p.docId);
    return new StreamableFile(f.stream, { type: f.contentType, length: f.sizeBytes, disposition: `attachment; filename*=UTF-8''${encodeURIComponent(f.fileName)}` });
  }

  // ---- letters ----------------------------------------------------------------------------
  @Get('letter-templates')
  @RequirePermissions(R)
  templates(@Auth() auth: AuthContext) {
    return this.employees.templates(auth);
  }
  @Post('letter-templates')
  @RequirePermissions('hr.letters.manage')
  @ApiZodBody(templateSchema)
  addTemplate(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(templateSchema)) b: z.infer<typeof templateSchema>) {
    return this.employees.saveTemplate(auth, null, b);
  }
  @Put('letter-templates/:id')
  @RequirePermissions('hr.letters.manage')
  @ApiZodBody(templateSchema)
  updateTemplate(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(templateSchema)) b: z.infer<typeof templateSchema>) {
    return this.employees.saveTemplate(auth, p.id, b);
  }
  @Post('employees/:id/letters')
  @RequirePermissions('hr.letters.manage')
  @ApiZodBody(letterSchema)
  issue(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(letterSchema)) b: z.infer<typeof letterSchema>) {
    return this.employees.issueLetter(auth, p.id, b);
  }
  @Get('letters/:id')
  @RequirePermissions(R)
  letter(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.employees.letter(auth, p.id);
  }

  private parse(schema: z.ZodType, body: unknown) {
    const r = schema.safeParse(body);
    if (!r.success) throw new BadRequestException({ message: r.error.issues[0]?.message ?? 'Invalid', errors: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    return r.data as Record<string, unknown>;
  }
}
