import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { batches, items, retainSamples } from '@nextgen/database';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { ESignService } from '../gmp/esign.service';
import { many } from '../../common/sql';

export const LOT_STATUSES = ['quarantine', 'under_test', 'released', 'conditional', 'rejected'] as const;
const MEANING: Record<string, string> = { released: 'QA release', conditional: 'Conditional release', rejected: 'QA rejection', quarantine: 'Placed on hold', under_test: 'Placed under test' };

export const lotStatusSchema = z.object({
  itemId: z.uuid(),
  batchNo: z.string().trim().min(1).max(40),
  status: z.enum(LOT_STATUSES),
  reason: z.string().trim().min(3, 'Give the reason').max(500),
  /** Electronic signature: the signer re-enters their password. */
  password: z.string().min(1, 'Enter your password to sign').max(200),
});
export type LotStatusInput = z.infer<typeof lotStatusSchema>;

export const retainSchema = z.object({
  itemId: z.uuid(),
  batchNo: z.string().trim().min(1).max(40),
  qty: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,12}(\.\d{1,4})?$/.test(v) && Number(v) > 0, 'Quantity must be more than zero'),
  location: z.string().trim().min(1).max(120),
  drawnOn: z.iso.date().optional(),
  retainUntil: z.iso.date(),
  inspectionId: z.uuid().nullable().optional(),
  notes: optionalText(500),
});

/**
 * Lot QC status, QA release with an electronic signature, and retain samples. Held lots
 * (quarantine, under test) cannot be issued, sold or consumed; rejected lots cannot be sold.
 */
@Injectable()
export class LotsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly esign: ESignService,
  ) {}

  list(auth: AuthContext, q: { status?: string; itemId?: string; q?: string; limit: number; offset: number }) {
    return this.database.run(auth, async (tx) => {
      const term = q.q ? `%${q.q}%` : null;
      const rows = await many<{ id: string; item_id: string; code: string; name: string; uom: string; batch_no: string; qc_status: string; qc_note: string | null; qc_updated_at: Date | null; expiry_date: string | null; stock: string; total: number }>(
        tx,
        sql`select b.id, b.item_id, i.code, i.name, u.code as uom, b.batch_no, b.qc_status, b.qc_note, b.qc_updated_at, b.expiry_date::text,
                   coalesce((select sum(sb.qty) from stock_balances sb where sb.batch_key = b.id), 0)::text as stock, count(*) over ()::int as total
            from batches b join items i on i.id = b.item_id join uoms u on u.id = i.base_uom_id
            where true
              ${q.status ? sql`and b.qc_status = ${q.status}` : sql`and b.qc_status <> 'released'`}
              ${q.itemId ? sql`and b.item_id = ${q.itemId}` : sql``}
              ${term ? sql`and (b.batch_no ilike ${term} or i.code ilike ${term} or i.name ilike ${term})` : sql``}
            order by b.qc_updated_at desc nulls last, b.created_at desc
            limit ${sql`${q.limit}::int`} offset ${sql`${q.offset}::int`}`,
      );
      return {
        total: rows[0]?.total ?? 0,
        items: rows.map((r) => ({ id: r.id, item: { id: r.item_id, code: r.code, name: r.name, uom: r.uom }, batchNo: r.batch_no, status: r.qc_status, note: r.qc_note, updatedAt: r.qc_updated_at, expiryDate: r.expiry_date, stock: r.stock })),
      };
    });
  }

  /** Changes a lot's status under an electronic signature (21 CFR Part 11 style: re-authenticate, meaning, reason, time). */
  setStatus(auth: AuthContext, input: LotStatusInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [b] = await tx.select().from(batches).where(and(eq(batches.itemId, input.itemId), sql`${batches.batchNo} = ${input.batchNo}`));
      if (!b) throw new NotFoundException('Lot not found');
      if (b.qcStatus === input.status) throw new ConflictException(`The lot is already ${input.status.replace('_', ' ')}`);
      const sig = await this.esign.sign(tx, auth, { entityType: 'batch', entityId: b.id, meaning: MEANING[input.status], reason: input.reason, payload: { itemId: input.itemId, batchNo: b.batchNo, from: b.qcStatus, to: input.status }, password: input.password, ip: meta.ip });
      await tx.update(batches).set({ qcStatus: input.status, qcNote: input.reason, qcUpdatedAt: new Date() }).where(eq(batches.id, b.id));
      return { id: b.id, batchNo: b.batchNo, status: input.status, signature: { id: sig.id, meaning: sig.meaning, signedBy: sig.signedBy, signedAt: sig.signedAt } };
    });
  }

  signatures(auth: AuthContext, entityId: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select s.id, s.meaning, s.reason, s.payload, s.signed_at as "signedAt", u.full_name as "signedBy", u.email
            from e_signatures s join users u on u.id = s.user_id where s.entity_id = ${entityId} order by s.signed_at`,
      ),
    );
  }

  // ---- retain samples ---------------------------------------------------------------------

  retains(auth: AuthContext, q: { itemId?: string; due?: string }) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select r.id, r.batch_no as "batchNo", r.qty::text, r.location, r.drawn_on::text as "drawnOn", r.retain_until::text as "retainUntil", r.disposed_on::text as "disposedOn", r.notes,
                   r.inspection_id as "inspectionId", i.id as "itemId", i.code, i.name, u.code as uom
            from retain_samples r join items i on i.id = r.item_id join uoms u on u.id = i.base_uom_id
            where true ${q.itemId ? sql`and r.item_id = ${q.itemId}` : sql``}
              ${q.due === 'true' ? sql`and r.disposed_on is null and r.retain_until <= (now() at time zone 'Asia/Kolkata')::date` : sql``}
            order by r.disposed_on nulls first, r.retain_until`,
      ),
    );
  }

  addRetain(auth: AuthContext, input: z.infer<typeof retainSchema>) {
    return this.database.run(auth, async (tx) => {
      const [it] = await tx.select({ id: items.id, trackBatch: items.trackBatch }).from(items).where(eq(items.id, input.itemId));
      if (!it) throw new NotFoundException('Item not found');
      const drawn = input.drawnOn ?? todayIST();
      if (input.retainUntil <= drawn) throw new BadRequestException('Keep the sample until a date after it was drawn');
      const [r] = await tx
        .insert(retainSamples)
        .values({ tenantId: auth.tenantId, itemId: input.itemId, batchNo: input.batchNo.toUpperCase(), qty: input.qty, location: input.location, drawnOn: drawn, retainUntil: input.retainUntil, inspectionId: input.inspectionId ?? null, notes: input.notes, createdBy: auth.userId })
        .returning();
      return r;
    });
  }

  disposeRetain(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.update(retainSamples).set({ disposedOn: todayIST(), disposedBy: auth.userId }).where(and(eq(retainSamples.id, id), sql`${retainSamples.disposedOn} is null`)).returning();
      if (!r) throw new ConflictException('Sample not found or already disposed of');
      return r;
    });
  }
}
