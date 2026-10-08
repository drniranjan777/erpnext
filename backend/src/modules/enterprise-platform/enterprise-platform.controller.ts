import { BadRequestException, Body, Catch, Controller, Delete, Get, HttpCode, HttpException, Param, Patch, Post, Put, Query, Req, Res, UseFilters, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, Public, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import type { Env } from '../../config/env';
import { SessionCookieService } from '../auth/session-cookie.service';
import { ScimService, tokenSchema } from './scim.service';
import { SSO_COOKIE, ssoSchema, SsoService } from './sso.service';
import { importSchema, TenantDataService } from './tenant-data.service';

const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const slugPipe = new ZodValidationPipe(z.object({ slug: z.string().regex(/^[a-z0-9-]{3,40}$/) }));
const SSO_PATH = '/api/v1/auth/sso';

@ApiTags('Enterprise platform')
@ApiBearerAuth()
@Controller()
export class EnterprisePlatformController {
  private readonly appUrl: string;
  private readonly secure: boolean;

  constructor(
    private readonly sso: SsoService,
    private readonly scim: ScimService,
    private readonly data: TenantDataService,
    private readonly cookies: SessionCookieService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true }).replace(/\/$/, '');
    this.secure = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  // ---- SSO settings and flow ---------------------------------------------------------------------

  @Get('platform/sso')
  @RequirePermissions('platform.sso.manage')
  ssoSettings(@Auth() auth: AuthContext) {
    return this.sso.get(auth);
  }

  @Put('platform/sso')
  @RequirePermissions('platform.sso.manage')
  @ApiZodBody(ssoSchema)
  saveSso(@Auth() auth: AuthContext, @Body(body(ssoSchema)) b: z.infer<typeof ssoSchema>) {
    return this.sso.save(auth, b);
  }

  @Public()
  @Get('auth/sso/:slug/start')
  async start(@Param(slugPipe) p: { slug: string }, @Query(body(z.object({ login_hint: z.string().max(200).optional() }))) q: { login_hint?: string }, @Res() res: FastifyReply) {
    const s = await this.sso.start(p.slug, q.login_hint ?? null);
    res.setCookie(SSO_COOKIE, s.cookie, { httpOnly: true, secure: this.secure, sameSite: 'lax', path: SSO_PATH, maxAge: 600 });
    res.status(302).header('location', s.url).send();
  }

  /** Back from the identity provider: on success the refresh cookie is set and the app opens. */
  @Public()
  @Get('auth/sso/callback')
  async callback(@Query() q: Record<string, string>, @Req() req: AppRequest, @Res() res: FastifyReply) {
    res.clearCookie(SSO_COOKIE, { path: SSO_PATH });
    try {
      const r = await this.sso.callback(q, req.cookies?.[SSO_COOKIE], requestMeta(req));
      this.cookies.set(res, r.tokens);
      res.status(302).header('location', `${this.appUrl}/dashboard`).send();
    } catch (err) {
      const msg = err instanceof HttpException ? err.message : 'Single sign-on failed';
      res.status(302).header('location', `${this.appUrl}/login?sso_error=${encodeURIComponent(msg)}`).send();
    }
  }

  @Public()
  @Get('auth/sso/:slug/saml/metadata')
  async samlMetadata(@Param(slugPipe) p: { slug: string }, @Res() res: FastifyReply) {
    res.header('content-type', 'application/samlmetadata+xml; charset=utf-8').send(await this.sso.samlMetadata(p.slug));
  }

  // ---- SCIM tokens -------------------------------------------------------------------------------

  @Get('platform/scim/tokens')
  @RequirePermissions('platform.sso.manage')
  scimTokens(@Auth() auth: AuthContext) {
    return this.scim.tokens(auth);
  }

  @Post('platform/scim/tokens')
  @RequirePermissions('platform.sso.manage')
  @ApiZodBody(tokenSchema)
  createScimToken(@Auth() auth: AuthContext, @Body(body(tokenSchema)) b: z.infer<typeof tokenSchema>) {
    return this.scim.createToken(auth, b);
  }

  @Delete('platform/scim/tokens/:id')
  @RequirePermissions('platform.sso.manage')
  revokeScimToken(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.scim.revokeToken(auth, p.id);
  }

  // ---- data export, import, sandbox, residency ---------------------------------------------------

  @Get('platform/data/residency')
  @RequirePermissions('platform.data.export')
  residency(@Auth() auth: AuthContext) {
    return this.data.residency(auth);
  }

  @Get('platform/data/export')
  @RequirePermissions('platform.data.export')
  async exportData(@Auth() auth: AuthContext, @Res() res: FastifyReply) {
    const f = await this.data.exportFile(auth);
    res.header('content-type', 'application/gzip').header('content-disposition', `attachment; filename="${f.name}"`).send(f.bytes);
  }

  @Post('platform/data/import')
  @RequirePermissions('platform.data.export')
  async importData(@Auth() auth: AuthContext, @Query(body(importSchema)) q: z.infer<typeof importSchema>, @Req() req: AppRequest) {
    if (!req.isMultipart()) throw new BadRequestException('Send the export file as multipart/form-data');
    const file = await req.file({ limits: { fileSize: 500 * 1_048_576 } });
    if (!file) throw new BadRequestException('No file received');
    const data = this.data.parseFile(await file.toBuffer());
    return this.data.importData(auth, data, { slug: q.slug, name: q.name ?? data.tenant.name });
  }

  @Post('platform/data/sandbox')
  @RequirePermissions('platform.data.export')
  sandbox(@Auth() auth: AuthContext, @Body(body(importSchema.pick({ slug: true }))) b: { slug: string }) {
    return this.data.sandbox(auth, b.slug);
  }
}

// ---- SCIM 2.0 ---------------------------------------------------------------------------------------

/** SCIM clients expect SCIM error bodies. */
@Catch()
class ScimErrorFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<FastifyReply>();
    const status = err instanceof HttpException ? err.getStatus() : 500;
    const detail = err instanceof HttpException ? err.message : 'Internal error';
    res
      .status(status)
      .header('content-type', 'application/scim+json')
      .send({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: String(status), detail, ...(status === 409 ? { scimType: 'uniqueness' } : {}) });
  }
}

/** SCIM 2.0 endpoints for identity providers (Microsoft Entra ID, Okta, OneLogin…), authenticated by a SCIM token. */
@ApiTags('SCIM 2.0')
@Public()
@UseFilters(ScimErrorFilter)
@Controller('scim/v2')
export class ScimController {
  private readonly base: string;

  constructor(
    private readonly scim: ScimService,
    config: ConfigService<Env, true>,
  ) {
    this.base = `${config.get('APP_URL', { infer: true }).replace(/\/$/, '')}/api/v1/scim/v2`;
  }

  private ctx(req: AppRequest) {
    return this.scim.authenticate(req.headers.authorization, this.base);
  }

  @Get('ServiceProviderConfig')
  async config(@Req() req: AppRequest) {
    return this.scim.serviceProviderConfig(await this.ctx(req));
  }

  @Get('Users')
  async users(@Req() req: AppRequest, @Query() q: { filter?: string; startIndex?: string; count?: string }) {
    return this.scim.listUsers(await this.ctx(req), q.filter, Math.max(1, Number(q.startIndex ?? 1) || 1), Math.min(100, Math.max(0, Number(q.count ?? 100) || 100)));
  }

  @Post('Users')
  @HttpCode(201)
  async createUser(@Req() req: AppRequest, @Body() b: Record<string, unknown>) {
    return this.scim.createUser(await this.ctx(req), b);
  }

  @Get('Users/:id')
  async user(@Req() req: AppRequest, @Param(idPipe) p: { id: string }) {
    return this.scim.getUser(await this.ctx(req), p.id);
  }

  @Put('Users/:id')
  async replaceUser(@Req() req: AppRequest, @Param(idPipe) p: { id: string }, @Body() b: Record<string, unknown>) {
    return this.scim.replaceUser(await this.ctx(req), p.id, b);
  }

  @Patch('Users/:id')
  async patchUser(@Req() req: AppRequest, @Param(idPipe) p: { id: string }, @Body() b: { Operations?: { op: string; path?: string; value?: unknown }[] }) {
    return this.scim.patchUser(await this.ctx(req), p.id, b);
  }

  @Delete('Users/:id')
  @HttpCode(204)
  async deleteUser(@Req() req: AppRequest, @Param(idPipe) p: { id: string }) {
    await this.scim.deleteUser(await this.ctx(req), p.id);
  }

  @Get('Groups')
  async groups(@Req() req: AppRequest, @Query() q: { filter?: string }) {
    return this.scim.listGroups(await this.ctx(req), q.filter);
  }

  @Get('Groups/:id')
  async group(@Req() req: AppRequest, @Param(idPipe) p: { id: string }) {
    return this.scim.getGroup(await this.ctx(req), p.id);
  }

  @Patch('Groups/:id')
  async patchGroup(@Req() req: AppRequest, @Param(idPipe) p: { id: string }, @Body() b: { Operations?: { op: string; path?: string; value?: unknown }[] }) {
    return this.scim.patchGroup(await this.ctx(req), p.id, b);
  }
}
