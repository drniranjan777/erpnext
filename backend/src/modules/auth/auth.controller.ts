import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, ApiZodQuery, Auth, Public } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { z } from 'zod';
import { loginSchema, mfaVerifySchema, signupSchema, slugCheckSchema, type LoginInput, type SignupInput } from './auth.schemas';
import { AuthService } from './auth.service';
import { REFRESH_COOKIE, SessionCookieService } from './session-cookie.service';
import { TokensService } from './tokens.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
    private readonly cookies: SessionCookieService,
  ) {}

  @Public()
  @Get('slug-availability')
  @ApiZodQuery(slugCheckSchema)
  async slugAvailability(@Query(new ZodValidationPipe(slugCheckSchema)) query: { slug: string }) {
    return { slug: query.slug, available: await this.auth.isSlugAvailable(query.slug) };
  }

  @Public()
  @Post('signup')
  @ApiZodBody(signupSchema)
  async signup(
    @Body(new ZodValidationPipe(signupSchema)) body: SignupInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    return this.cookies.respond(await this.auth.signup(body, requestMeta(req)), res);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiZodBody(loginSchema)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    return this.cookies.respond(await this.auth.login(body, requestMeta(req)), res);
  }

  @Public()
  @Post('mfa/verify')
  @HttpCode(200)
  @ApiZodBody(mfaVerifySchema)
  async verifyMfa(
    @Body(new ZodValidationPipe(mfaVerifySchema)) body: z.infer<typeof mfaVerifySchema>,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    return this.cookies.respond(await this.auth.verifyMfa(body.mfaToken, body.code, requestMeta(req)), res);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: AppRequest, @Res({ passthrough: true }) res: FastifyReply) {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) {
      res.status(401);
      return { type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'No active session' };
    }
    const rotated = await this.tokens.rotate(token, requestMeta(req));
    this.cookies.set(res, rotated);
    return { accessToken: rotated.accessToken, expiresIn: rotated.accessTokenExpiresIn };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AppRequest, @Res({ passthrough: true }) res: FastifyReply) {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token) await this.tokens.revokeByToken(token);
    this.cookies.clear(res);
  }

  @ApiBearerAuth()
  @Get('me')
  me(@Auth() auth: AuthContext) {
    return this.auth.me(auth);
  }
}
