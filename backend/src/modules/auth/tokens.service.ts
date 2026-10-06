import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { authSessions } from '@nextgen/database';
import { and, eq, isNull } from 'drizzle-orm';
import { AccessCacheService } from '../../common/access-cache.service';
import type { AccessTokenClaims } from '../../common/auth-context';
import type { Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';

interface RefreshClaims extends AccessTokenClaims {
  n: string;
}

export interface SessionIdentity {
  userId: string;
  tenantId: string;
  membershipId: string;
}

export interface ClientMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/**
 * Short-lived access JWT + rotating refresh token bound to an auth_sessions row.
 * Re-use of an already-rotated refresh token revokes the whole session.
 */
@Injectable()
export class TokensService {
  private readonly accessTtl: number;
  private readonly refreshTtlDays: number;
  private readonly refreshSecret: string;

  constructor(
    private readonly jwt: JwtService,
    private readonly database: DatabaseService,
    private readonly cache: AccessCacheService,
    config: ConfigService<Env, true>,
  ) {
    this.accessTtl = config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
    this.refreshTtlDays = config.get('JWT_REFRESH_TTL_DAYS', { infer: true });
    this.refreshSecret = config.get('JWT_REFRESH_SECRET', { infer: true });
  }

  async issue(identity: SessionIdentity, meta: ClientMeta): Promise<IssuedTokens> {
    const expiresAt = new Date(Date.now() + this.refreshTtlDays * 86_400_000);
    const [session] = await this.database.run({ tenantId: identity.tenantId, userId: identity.userId }, (tx) =>
      tx
        .insert(authSessions)
        .values({
          tenantId: identity.tenantId,
          userId: identity.userId,
          refreshTokenHash: 'pending',
          userAgent: meta.userAgent?.slice(0, 500) ?? null,
          ip: meta.ip ?? null,
          expiresAt,
        })
        .returning({ id: authSessions.id }),
    );
    return this.mint(identity, session.id, expiresAt);
  }

  async rotate(refreshToken: string, meta: ClientMeta): Promise<IssuedTokens & { identity: SessionIdentity }> {
    let claims: RefreshClaims;
    try {
      claims = await this.jwt.verifyAsync<RefreshClaims>(refreshToken, { secret: this.refreshSecret });
    } catch {
      throw new UnauthorizedException('Session expired, please sign in again');
    }
    const identity = { userId: claims.sub, tenantId: claims.tid, membershipId: claims.mid };
    const ctx = { tenantId: identity.tenantId, userId: identity.userId };

    const session = await this.database.run(ctx, async (tx) => {
      const [row] = await tx.select().from(authSessions).where(eq(authSessions.id, claims.sid));
      return row;
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired, please sign in again');
    }
    const presented = Buffer.from(sha256(refreshToken));
    const stored = Buffer.from(session.refreshTokenHash);
    if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) {
      // Token re-use: someone replayed an old refresh token. Kill the session.
      await this.revoke(identity, claims.sid);
      throw new UnauthorizedException('Session expired, please sign in again');
    }

    await this.database.run(ctx, (tx) =>
      tx
        .update(authSessions)
        .set({ lastUsedAt: new Date(), ip: meta.ip ?? session.ip, userAgent: meta.userAgent?.slice(0, 500) ?? session.userAgent })
        .where(eq(authSessions.id, claims.sid)),
    );
    const tokens = await this.mint(identity, claims.sid, session.expiresAt);
    return { ...tokens, identity };
  }

  /** Revokes a session given a (possibly expired) refresh token. Never throws. */
  async revokeByToken(refreshToken: string): Promise<void> {
    const claims = this.jwt.decode<RefreshClaims | null>(refreshToken);
    if (!claims?.sid || !claims.tid || !claims.sub) return;
    try {
      await this.jwt.verifyAsync(refreshToken, { secret: this.refreshSecret, ignoreExpiration: true });
      await this.revoke({ userId: claims.sub, tenantId: claims.tid, membershipId: claims.mid }, claims.sid);
    } catch {
      /* forged token - nothing to revoke */
    }
  }

  private async revoke(identity: SessionIdentity, sessionId: string) {
    this.cache.invalidateSession(sessionId);
    await this.database.run({ tenantId: identity.tenantId, userId: identity.userId }, (tx) =>
      tx
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(authSessions.id, sessionId), isNull(authSessions.revokedAt))),
    );
  }

  private async mint(identity: SessionIdentity, sessionId: string, refreshExpiresAt: Date): Promise<IssuedTokens> {
    const base: AccessTokenClaims = { sub: identity.userId, tid: identity.tenantId, mid: identity.membershipId, sid: sessionId };
    const accessToken = await this.jwt.signAsync(base, { expiresIn: this.accessTtl });
    const refreshClaims: RefreshClaims = { ...base, n: randomBytes(16).toString('base64url') };
    const refreshToken = await this.jwt.signAsync(refreshClaims, {
      secret: this.refreshSecret,
      expiresIn: Math.max(1, Math.floor((refreshExpiresAt.getTime() - Date.now()) / 1000)),
    });
    await this.database.run({ tenantId: identity.tenantId, userId: identity.userId }, (tx) =>
      tx.update(authSessions).set({ refreshTokenHash: sha256(refreshToken) }).where(eq(authSessions.id, sessionId)),
    );
    return { accessToken, accessTokenExpiresIn: this.accessTtl, refreshToken, refreshTokenExpiresAt: refreshExpiresAt };
  }
}
