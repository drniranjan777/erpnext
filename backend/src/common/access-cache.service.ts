import { Injectable } from '@nestjs/common';

interface Entry<T> {
  value: T;
  expires: number;
  tenantId: string;
}

/**
 * Short-lived, per-process cache for per-request access checks:
 *  - session still valid + membership active (AuthGuard)
 *  - effective permissions (PermissionsGuard)
 * Local invalidation is immediate; other instances converge within the TTL.
 * (A shared Redis cache can replace this when we run many API instances.)
 */
@Injectable()
export class AccessCacheService {
  static readonly SESSION_TTL_MS = 15_000;
  static readonly PERMISSIONS_TTL_MS = 30_000;

  private readonly sessions = new Map<string, Entry<true>>();
  private readonly permissions = new Map<string, Entry<Set<string>>>();

  getSession(sessionId: string) {
    return this.read(this.sessions, sessionId);
  }

  setSession(sessionId: string, tenantId: string) {
    this.write(this.sessions, sessionId, true, tenantId, AccessCacheService.SESSION_TTL_MS);
  }

  getPermissions(membershipId: string) {
    return this.read(this.permissions, membershipId);
  }

  setPermissions(membershipId: string, tenantId: string, perms: Set<string>) {
    this.write(this.permissions, membershipId, perms, tenantId, AccessCacheService.PERMISSIONS_TTL_MS);
  }

  /** Call after any change to roles, memberships or sessions in a tenant. */
  invalidateTenant(tenantId: string) {
    for (const map of [this.sessions, this.permissions] as Map<string, Entry<unknown>>[]) {
      for (const [k, v] of map) if (v.tenantId === tenantId) map.delete(k);
    }
  }

  invalidateSession(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  private read<T>(map: Map<string, Entry<T>>, key: string): T | undefined {
    const e = map.get(key);
    if (!e) return undefined;
    if (e.expires < Date.now()) {
      map.delete(key);
      return undefined;
    }
    return e.value;
  }

  private write<T>(map: Map<string, Entry<T>>, key: string, value: T, tenantId: string, ttl: number) {
    if (map.size > 50_000) map.clear(); // crude bound
    map.set(key, { value, tenantId, expires: Date.now() + ttl });
  }
}
