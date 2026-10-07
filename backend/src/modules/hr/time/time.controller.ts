import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../../common/decorators';
import { todayIST } from '../../../common/fiscal-year';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import { adjustSchema, applySchema, decideLeaveSchema, LeaveService, leaveTypeSchema, monthSchema, yearSchema } from './leave.service';
import { assignSchema, decideSchema, holidaySchema, mobileSchema, processSchema, pushSchema, regulariseSchema, shiftSchema, TimeService } from './time.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const year = z.coerce.number().int().min(2000).max(2100);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month as YYYY-MM');

/**
 * Time and leave. Routes without @RequirePermissions are self-service: the service lets the
 * employee act for themselves (hr.self.use), their reporting manager for the team, and HR for anyone.
 */
@ApiTags('HR time and leave')
@ApiBearerAuth()
@Controller('hr')
export class TimeController {
  constructor(
    private readonly time: TimeService,
    private readonly leave: LeaveService,
  ) {}

  // ---- shifts, rosters, holidays ----------------------------------------------------------
  @Get('shifts')
  @RequirePermissions('hr.attendance.read')
  shifts(@Auth() auth: AuthContext) {
    return this.time.shifts(auth);
  }
  @Post('shifts')
  @RequirePermissions('hr.attendance.manage')
  @ApiZodBody(shiftSchema)
  addShift(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(shiftSchema)) b: z.infer<typeof shiftSchema>) {
    return this.time.saveShift(auth, null, b);
  }
  @Put('shifts/:id')
  @RequirePermissions('hr.attendance.manage')
  @ApiZodBody(shiftSchema)
  updateShift(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(shiftSchema)) b: z.infer<typeof shiftSchema>) {
    return this.time.saveShift(auth, p.id, b);
  }
  @Get('roster')
  @RequirePermissions('hr.attendance.read')
  roster(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ date: z.iso.date().optional() }))) q: { date?: string }) {
    return this.time.roster(auth, q.date ?? todayIST());
  }
  @Post('roster')
  @HttpCode(200)
  @RequirePermissions('hr.attendance.manage')
  @ApiZodBody(assignSchema)
  assign(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(assignSchema)) b: z.infer<typeof assignSchema>) {
    return this.time.assign(auth, b);
  }
  @Get('holidays')
  @RequirePermissions('hr.attendance.read')
  holidays(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ year: year.optional() }))) q: { year?: number }) {
    return this.time.holidays(auth, q.year ?? Number(todayIST().slice(0, 4)));
  }
  @Post('holidays')
  @RequirePermissions('hr.attendance.manage')
  @ApiZodBody(holidaySchema)
  addHoliday(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(holidaySchema)) b: z.infer<typeof holidaySchema>) {
    return this.time.addHoliday(auth, b);
  }
  @Delete('holidays/:id')
  @RequirePermissions('hr.attendance.manage')
  removeHoliday(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.time.removeHoliday(auth, p.id);
  }

  // ---- punches and attendance -------------------------------------------------------------
  /** For biometric devices and their middleware: authenticate with an API key holding hr.attendance.manage. */
  @Post('attendance/punches')
  @HttpCode(200)
  @RequirePermissions('hr.attendance.manage')
  @ApiZodBody(pushSchema)
  push(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(pushSchema)) b: z.infer<typeof pushSchema>) {
    return this.time.push(auth, b);
  }
  @Post('attendance/punches/import')
  @HttpCode(200)
  @RequirePermissions('hr.attendance.manage')
  @ApiConsumes('multipart/form-data')
  async importPunches(@Auth() auth: AuthContext, @Req() req: AppRequest) {
    if (!req.isMultipart()) throw new BadRequestException('Send the file as multipart/form-data');
    const file = await req.file();
    if (!file) throw new BadRequestException('No file received');
    return this.time.importFile(auth, await file.toBuffer(), file.filename);
  }
  @Get('attendance/punches')
  @RequirePermissions('hr.attendance.read')
  punches(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ date: z.iso.date().optional(), employeeId: z.uuid().optional(), flagged: z.stringbool().optional() }))) q: { date?: string; employeeId?: string; flagged?: boolean }) {
    return this.time.punches(auth, q);
  }
  @Get('attendance/punches/:id/selfie')
  @RequirePermissions('hr.attendance.read')
  async selfie(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    const f = await this.time.selfie(auth, p.id);
    return new StreamableFile(f.stream, { type: f.contentType, length: f.sizeBytes, disposition: 'inline' });
  }
  /** multipart/form-data: latitude, longitude, accuracy, then the selfie image. */
  @Post('attendance/mobile')
  @ApiConsumes('multipart/form-data')
  async mobile(@Auth() auth: AuthContext, @Req() req: AppRequest) {
    if (!req.isMultipart()) throw new BadRequestException('Send the punch as multipart/form-data');
    const file = await req.file();
    if (!file) throw new BadRequestException('Take a selfie to punch');
    const field = (name: string) => {
      const f = file.fields[name] as { value?: unknown } | undefined;
      return typeof f?.value === 'string' ? f.value : undefined;
    };
    const parsed = mobileSchema.safeParse({ latitude: field('latitude'), longitude: field('longitude'), accuracy: field('accuracy') });
    if (!parsed.success) {
      file.file.resume();
      throw new BadRequestException('Location is needed to punch; allow location access and try again');
    }
    return this.time.mobilePunch(auth, parsed.data, file);
  }
  @Post('attendance/process')
  @HttpCode(200)
  @RequirePermissions('hr.attendance.manage')
  @ApiZodBody(processSchema)
  process(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(processSchema)) b: z.infer<typeof processSchema>) {
    return this.time.process(auth, b);
  }
  @Get('attendance/month')
  @RequirePermissions('hr.attendance.read')
  month(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ month, departmentId: z.uuid().optional(), locationId: z.uuid().optional(), employeeId: z.uuid().optional() }))) q: { month: string; departmentId?: string; locationId?: string; employeeId?: string }) {
    return this.time.month(auth, q);
  }
  @Get('attendance/day')
  day(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ employeeId: z.uuid(), date: z.iso.date() }))) q: { employeeId: string; date: string }) {
    return this.time.day(auth, q.employeeId, q.date);
  }
  @Get('me')
  me(@Auth() auth: AuthContext) {
    return this.time.me(auth);
  }

  // ---- regularisation ---------------------------------------------------------------------
  @Get('attendance/regularisations')
  regularisations(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() }))) q: { status?: string }) {
    return this.time.regularisations(auth, q);
  }
  @Post('attendance/regularisations')
  @ApiZodBody(regulariseSchema)
  regularise(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(regulariseSchema)) b: z.infer<typeof regulariseSchema>) {
    return this.time.requestRegularisation(auth, b);
  }
  @Post('attendance/regularisations/:id/decide')
  @HttpCode(200)
  @ApiZodBody(decideSchema)
  decideRegularisation(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(decideSchema)) b: z.infer<typeof decideSchema>) {
    return this.time.decideRegularisation(auth, p.id, b);
  }

  // ---- leave ------------------------------------------------------------------------------
  @Get('leave/types')
  leaveTypes(@Auth() auth: AuthContext) {
    return this.leave.types(auth);
  }
  @Post('leave/types')
  @RequirePermissions('hr.leave.manage')
  @ApiZodBody(leaveTypeSchema)
  addLeaveType(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(leaveTypeSchema)) b: z.infer<typeof leaveTypeSchema>) {
    return this.leave.saveType(auth, null, b);
  }
  @Put('leave/types/:id')
  @RequirePermissions('hr.leave.manage')
  @ApiZodBody(leaveTypeSchema)
  updateLeaveType(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(leaveTypeSchema)) b: z.infer<typeof leaveTypeSchema>) {
    return this.leave.saveType(auth, p.id, b);
  }
  @Get('leave/balances')
  balances(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ employeeId: z.uuid().optional(), all: z.stringbool().optional(), year: year.optional() }))) q: { employeeId?: string; all?: boolean; year?: number }) {
    return this.leave.balances(auth, { ...q, year: q.year ?? Number(todayIST().slice(0, 4)) });
  }
  @Get('leave/ledger')
  ledger(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ employeeId: z.uuid(), year: year.optional() }))) q: { employeeId: string; year?: number }) {
    return this.leave.ledger(auth, q.employeeId, q.year ?? Number(todayIST().slice(0, 4)));
  }
  @Post('leave/adjust')
  @RequirePermissions('hr.leave.manage')
  @ApiZodBody(adjustSchema)
  adjust(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(adjustSchema)) b: z.infer<typeof adjustSchema>) {
    return this.leave.adjust(auth, b);
  }
  @Post('leave/accrue')
  @HttpCode(200)
  @RequirePermissions('hr.leave.manage')
  @ApiZodBody(monthSchema)
  accrue(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(monthSchema)) b: { month: string }) {
    return this.leave.accrue(auth, b.month);
  }
  @Post('leave/year-end')
  @HttpCode(200)
  @RequirePermissions('hr.leave.manage')
  @ApiZodBody(yearSchema)
  yearEnd(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(yearSchema)) b: { year: number }) {
    return this.leave.yearEnd(auth, b.year);
  }
  @Get('leave/applications')
  applications(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(), employeeId: z.uuid().optional() }))) q: { status?: string; employeeId?: string }) {
    return this.leave.applications(auth, q);
  }
  @Post('leave/applications')
  @ApiZodBody(applySchema)
  apply(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(applySchema)) b: z.infer<typeof applySchema>) {
    return this.leave.apply(auth, b);
  }
  @Post('leave/applications/:id/decide')
  @HttpCode(200)
  @ApiZodBody(decideLeaveSchema)
  decide(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(decideLeaveSchema)) b: z.infer<typeof decideLeaveSchema>) {
    return this.leave.decide(auth, p.id, b);
  }
  @Post('leave/applications/:id/cancel')
  @HttpCode(200)
  cancel(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.leave.cancel(auth, p.id);
  }
  @Get('leave/calendar')
  calendar(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ from: z.iso.date(), to: z.iso.date() }))) q: { from: string; to: string }) {
    return this.leave.calendar(auth, q.from, q.to);
  }
}
