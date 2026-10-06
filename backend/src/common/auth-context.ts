import type { FastifyRequest } from 'fastify';

/** Identity attached to every authenticated request by AuthGuard. */
export interface AuthContext {
  userId: string;
  tenantId: string;
  membershipId: string;
  /** auth_sessions row behind this token. */
  sessionId: string;
  /** Loaded lazily by PermissionsGuard. */
  permissions?: Set<string>;
}

export type AppRequest = FastifyRequest & { auth?: AuthContext };

/** Claims carried in the access token. */
export interface AccessTokenClaims {
  sub: string;
  tid: string;
  mid: string;
  sid: string;
}
