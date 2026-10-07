import { ForbiddenException, Injectable } from '@nestjs/common';
import { eSignatures, users, type Transaction } from '@nextgen/database';
import { verify } from '@node-rs/argon2';
import { asc, desc, eq, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { DatabaseService } from '../../database/database.service';
import { chainHash, recordHash, verifyChain } from './rules';

export interface SignInput {
  entityType: string;
  entityId: string;
  /** What the signature means: "QA release", "Line clearance verified"… */
  meaning: string;
  reason?: string | null;
  /** What is being signed, exactly as it is: hashed and kept with the signature. */
  payload: Record<string, unknown>;
  password: string;
  ip?: string | null;
}

/**
 * Electronic signatures (21 CFR Part 11 / EU GMP Annex 11): the signer re-enters their password
 * for every signature; the signature records who, when, the meaning and the reason, carries the
 * signer's name as it was, is linked to the signed content by a hash, and is chained to the
 * signature before it so that any change or removal is detectable. Rows can never be updated or
 * deleted by the application (database privileges).
 */
@Injectable()
export class ESignService {
  constructor(private readonly database: DatabaseService) {}

  async sign(tx: Transaction, auth: AuthContext, input: SignInput) {
    const [u] = await tx.select({ hash: users.passwordHash, name: users.fullName }).from(users).where(eq(users.id, auth.userId));
    if (!u || !(await verify(u.hash, input.password).catch(() => false))) throw new ForbiddenException('Signature failed: the password is not correct');
    // One signer at a time per workspace, so the chain has a single order.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('esign:' || ${auth.tenantId}))`);
    const [prev] = await tx.select({ chainHash: eSignatures.chainHash }).from(eSignatures).where(sql`${eSignatures.chainHash} is not null`).orderBy(desc(eSignatures.signedAt), desc(eSignatures.id)).limit(1);
    const id = (await tx.execute<{ id: string }>(sql`select uuidv7()::text as id`)).rows[0].id;
    const signedAt = new Date();
    const link = { id, userId: auth.userId, entityType: input.entityType, entityId: input.entityId, meaning: input.meaning, recordHash: recordHash(input.payload), signedAt: signedAt.toISOString() };
    const [sig] = await tx
      .insert(eSignatures)
      .values({
        id,
        tenantId: auth.tenantId,
        userId: auth.userId,
        entityType: input.entityType,
        entityId: input.entityId,
        meaning: input.meaning,
        reason: input.reason ?? null,
        payload: input.payload,
        ip: input.ip ?? null,
        signedAt,
        signerName: u.name,
        recordHash: link.recordHash,
        chainHash: chainHash(prev?.chainHash ?? null, link),
      })
      .returning();
    return { id: sig.id, meaning: sig.meaning, reason: sig.reason, signedBy: u.name, signedAt: sig.signedAt };
  }

  /** Signatures on a record, as they are shown (manifestation). */
  forRecord(tx: Transaction, entityType: string, entityId: string) {
    return tx
      .select({ id: eSignatures.id, meaning: eSignatures.meaning, reason: eSignatures.reason, signedBy: sql<string>`coalesce(${eSignatures.signerName}, ${users.fullName})`, signedAt: eSignatures.signedAt })
      .from(eSignatures)
      .innerJoin(users, eq(users.id, eSignatures.userId))
      .where(sql`${eSignatures.entityType} = ${entityType} and ${eSignatures.entityId} = ${entityId}`)
      .orderBy(asc(eSignatures.signedAt));
  }

  /** Recomputes the whole chain of the workspace. */
  verify(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx.select().from(eSignatures).orderBy(asc(eSignatures.signedAt), asc(eSignatures.id));
      const r = verifyChain(rows.map((s) => ({ id: s.id, userId: s.userId, entityType: s.entityType, entityId: s.entityId, meaning: s.meaning, recordHash: s.recordHash ?? '', signedAt: s.signedAt.toISOString(), chainHash: s.chainHash, payload: s.payload })));
      return { total: rows.length, ...r, intact: r.broken.length === 0 };
    });
  }
}
