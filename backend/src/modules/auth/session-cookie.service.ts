import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply } from 'fastify';
import type { Env } from '../../config/env';
import type { LoginResult } from './auth.service';
import type { IssuedTokens } from './tokens.service';

export const REFRESH_COOKIE = 'ngerp_rt';
/** Refresh cookie is only sent to /api/v1/auth/* endpoints. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/** Turns a login result into the HTTP response + refresh cookie. */
@Injectable()
export class SessionCookieService {
  private readonly secure: boolean;

  constructor(config: ConfigService<Env, true>) {
    this.secure = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  respond(result: LoginResult, res: FastifyReply) {
    if (result.kind === 'select-tenant') return { requiresTenantSelection: true, tenants: result.tenants };
    if (result.kind === 'mfa-required') return { mfaRequired: true, mfaToken: result.mfaToken };
    this.set(res, result.tokens);
    const { membershipId: _m, ...tenant } = result.tenant;
    return {
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.accessTokenExpiresIn,
      user: result.user,
      tenant,
    };
  }

  set(res: FastifyReply, tokens: IssuedTokens) {
    res.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      expires: tokens.refreshTokenExpiresAt,
    });
  }

  clear(res: FastifyReply) {
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  }
}
