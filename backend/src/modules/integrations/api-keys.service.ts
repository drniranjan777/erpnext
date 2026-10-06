import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { apiKeys, ALL_PERMISSIONS, users } from '@nextgen/database';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AccessCacheService } from '../../common/access-cache.service';
import type { AuthContext } from '../../common/auth-context';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../billing/entitlements.service';

export const createApiKeySchema = z.object({
  name: z.string().trim().min(2).max(60),
  scopes: z
    .array(z.string())
    .min(1, 'Choose at least one permission')
    .max(100)
    .refine((s) => s.every((c) => (ALL_PERMISSIONS as string[]).includes(c)), 'Unknown permission'),
  expiresInDays: z.number().int().min(1).max(730).optional().nullable(),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export interface ApiKeyIdentity {
  keyId: string;
  tenantId: string;
  userId: string;
  membershipId: string;
  permissions: Set<string>;
}

/**
 * API keys look like `ngk_<prefix>_<secret>`. Only a SHA-256 hash is stored.
 * A key acts as its creator, limited to the chosen scopes. It never exceeds the
 * creator's current permissions and stops working if the creator is disabled.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly cache: AccessCacheService,
  ) {}

  list(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      tx
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          prefix: apiKeys.prefix,
          scopes: apiKeys.scopes,
          createdAt: apiKeys.createdAt,
          lastUsedAt: apiKeys.lastUsedAt,
          expiresAt: apiKeys.expiresAt,
          revokedAt: apiKeys.revokedAt,
          createdBy: users.fullName,
        })
        .from(apiKeys)
        .leftJoin(users, eq(users.id, apiKeys.createdBy))
        .orderBy(desc(apiKeys.createdAt)),
    );
  }

  async create(auth: AuthContext, input: CreateApiKeyInput, meta: RequestMeta) {
    await this.entitlements.assertFeature(auth.tenantId, 'api_access');
    const mine = await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId);
    const beyond = input.scopes.filter((s) => !mine.has(s));
    if (beyond.length) throw new BadRequestException(`You can't grant permissions you don't have: ${beyond.join(', ')}`);

    const prefix = randomBytes(6).toString('hex');
    const secret = randomBytes(24).toString('base64url');
    const key = `ngk_${prefix}_${secret}`;
    return this.database.run(auth, async (tx) => {
      await this.entitlements.assertLimit(tx, auth.tenantId, 'apiKeys');
      const [row] = await tx
        .insert(apiKeys)
        .values({
          tenantId: auth.tenantId,
          name: input.name,
          prefix,
          keyHash: sha256(key),
          scopes: [...new Set(input.scopes)],
          createdBy: auth.userId,
          membershipId: auth.membershipId,
          expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null,
        })
        .returning({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, expiresAt: apiKeys.expiresAt });
      await this.audit.log(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'platform.api_key.created',
        entityType: 'api_key',
        entityId: row.id,
        metadata: { name: input.name, prefix, scopes: input.scopes },
        ...meta,
      });
      // The full key is returned exactly once.
      return { ...row, key };
    });
  }

  async revoke(auth: AuthContext, id: string, meta: RequestMeta) {
    await this.database.run(auth, async (tx) => {
      const [row] = await tx
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
        .returning({ name: apiKeys.name, prefix: apiKeys.prefix });
      if (!row) throw new NotFoundException('API key not found or already revoked');
      await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'platform.api_key.revoked', entityType: 'api_key', entityId: id, metadata: row, ...meta });
    });
    this.cache.invalidateSession(`apikey:${id}`);
  }

  /** Authenticates a presented key. Returns null when invalid (callers answer 401). */
  async authenticate(key: string): Promise<ApiKeyIdentity | null> {
    const m = /^ngk_([0-9a-f]{12})_([A-Za-z0-9_-]{32})$/.exec(key);
    if (!m) return null;
    const res = await this.database.run({}, (tx) =>
      tx.execute<{
        id: string;
        tenant_id: string;
        key_hash: string;
        scopes: string[];
        created_by: string;
        membership_id: string;
        expires_at: Date | null;
        revoked_at: Date | null;
        last_used_at: Date | null;
        tenant_status: string;
        membership_status: string;
      }>(sql`select * from api_key_lookup(${m[1]})`),
    );
    const k = res.rows[0];
    if (!k) return null;
    const given = Buffer.from(sha256(key));
    const stored = Buffer.from(k.key_hash);
    if (given.length !== stored.length || !timingSafeEqual(given, stored)) return null;
    if (k.revoked_at || (k.expires_at && new Date(k.expires_at) < new Date())) return null;
    if (k.membership_status !== 'active' || k.tenant_status === 'suspended' || k.tenant_status === 'archived') return null;

    const e = await this.entitlements.get(k.tenant_id);
    if (!e.features.includes('api_access')) return null;

    const creatorPerms = await loadPermissions(this.database, k.tenant_id, k.created_by, k.membership_id, this.cache);
    const permissions = new Set(k.scopes.filter((s) => creatorPerms.has(s)));

    // Record usage at most once a minute per key.
    if (!k.last_used_at || Date.now() - new Date(k.last_used_at).getTime() > 60_000) {
      void this.database
        .run({ tenantId: k.tenant_id, userId: k.created_by }, (tx) => tx.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, k.id)))
        .catch(() => undefined);
    }
    return { keyId: k.id, tenantId: k.tenant_id, userId: k.created_by, membershipId: k.membership_id, permissions };
  }
}
