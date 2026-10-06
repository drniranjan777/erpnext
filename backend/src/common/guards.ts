import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { authSessions, membershipRoles, memberships, rolePermissions } from '@nextgen/database';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { ApiKeysService } from '../modules/integrations/api-keys.service';
import { AccessCacheService } from './access-cache.service';
import type { AccessTokenClaims, AppRequest } from './auth-context';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from './decorators';

/**
 * Global guard: every route requires a valid access token unless @Public().
 * Besides the JWT signature it checks that the session is not revoked and the
 * membership is still active (cached briefly), so sign-outs and disabled users
 * take effect within seconds instead of at token expiry.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly database: DatabaseService,
    private readonly cache: AccessCacheService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AppRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    const headerKey = req.headers['x-api-key'];
    const apiKey = typeof headerKey === 'string' ? headerKey : scheme === 'Bearer' && token?.startsWith('ngk_') ? token : null;
    if (apiKey) {
      const identity = await this.apiKeys.authenticate(apiKey);
      if (!identity) throw new UnauthorizedException('Invalid, expired or revoked API key');
      req.auth = {
        userId: identity.userId,
        tenantId: identity.tenantId,
        membershipId: identity.membershipId,
        sessionId: `apikey:${identity.keyId}`,
        permissions: identity.permissions,
      };
      return true;
    }
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Missing access token');

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    if (!this.cache.getSession(claims.sid)) {
      const [live] = await this.database.run({ tenantId: claims.tid, userId: claims.sub }, (tx) =>
        tx
          .select({ id: authSessions.id })
          .from(authSessions)
          .innerJoin(memberships, and(eq(memberships.id, claims.mid), eq(memberships.userId, authSessions.userId)))
          .where(
            and(
              eq(authSessions.id, claims.sid),
              isNull(authSessions.revokedAt),
              gt(authSessions.expiresAt, new Date()),
              eq(memberships.status, 'active'),
            ),
          ),
      );
      if (!live) throw new UnauthorizedException('Your session has ended. Please sign in again.');
      this.cache.setSession(claims.sid, claims.tid);
    }

    req.auth = { userId: claims.sub, tenantId: claims.tid, membershipId: claims.mid, sessionId: claims.sid };
    return true;
  }
}

/** Global guard: enforces @RequirePermissions() against the caller's roles. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly database: DatabaseService,
    private readonly cache: AccessCacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    const req = context.switchToHttp().getRequest<AppRequest>();
    const viaApiKey = !!req.auth?.sessionId.startsWith('apikey:');
    // API keys may only call permission-guarded business endpoints (not account, MFA, sessions...).
    if (viaApiKey && !required?.length) throw new ForbiddenException('API keys cannot access this endpoint');
    if (!required?.length) return true;
    if (!req.auth) throw new UnauthorizedException();

    const granted = viaApiKey && req.auth.permissions
      ? req.auth.permissions
      : await loadPermissions(this.database, req.auth.tenantId, req.auth.userId, req.auth.membershipId, this.cache);
    req.auth.permissions = granted;
    const missing = required.filter((p) => !granted.has(p));
    if (missing.length) throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    return true;
  }
}

/** Effective permissions of an active membership (cached for a few seconds when a cache is given). */
export async function loadPermissions(
  database: DatabaseService,
  tenantId: string,
  userId: string,
  membershipId: string,
  cache?: AccessCacheService,
): Promise<Set<string>> {
  const cached = cache?.getPermissions(membershipId);
  if (cached) return cached;
  const rows = await database.run({ tenantId, userId }, (tx) =>
    tx
      .selectDistinct({ code: rolePermissions.permissionCode })
      .from(membershipRoles)
      .innerJoin(memberships, eq(memberships.id, membershipRoles.membershipId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, membershipRoles.roleId))
      .where(and(eq(membershipRoles.membershipId, membershipId), eq(memberships.status, 'active'))),
  );
  const perms = new Set(rows.map((r) => r.code));
  cache?.setPermissions(membershipId, tenantId, perms);
  return perms;
}
