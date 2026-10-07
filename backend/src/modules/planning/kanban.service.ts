import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { items, kanbanCards, kanbanLoops, uoms, warehouses, type Transaction } from '@nextgen/database';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { StockEntriesService } from '../inventory/stock-entries.service';
import { WorkOrdersService } from '../manufacturing/work-orders.service';
import { RequisitionsService } from '../purchase/requisitions.service';
import { addDays } from './mrp-engine';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;

const qty = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,12}(\.\d{1,4})?$/.test(v) && Number(v) > 0, 'Container quantity must be more than zero (up to 4 decimals)');

export const loopSchema = z.object({
  itemId: z.uuid(),
  kind: z.enum(['production', 'purchase', 'transfer']),
  warehouseId: z.uuid(),
  sourceWarehouseId: z.uuid().nullable().optional(),
  vendorId: z.uuid().nullable().optional(),
  containerQty: qty,
  cards: z.number().int().min(1).max(99),
  leadTimeDays: z.number().int().min(0).max(365).default(1),
  notes: optionalText(500),
  isActive: z.boolean().default(true),
});
export type LoopInput = z.infer<typeof loopSchema>;

const PERM = { production: 'manufacturing.production.manage', purchase: 'purchase.requisitions.manage', transfer: 'inventory.entries.manage' } as const;

/**
 * Kanban: fixed containers circulating between a point of use and its supplier. Signalling a
 * card empty raises the replenishment as a draft (work order, requisition or transfer);
 * receiving the container marks the card full again. Cards print with a `KB:<id>` code.
 */
@Injectable()
export class KanbanService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workOrders: WorkOrdersService,
    private readonly requisitions: RequisitionsService,
    private readonly stockEntries: StockEntriesService,
  ) {}

  list(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const loops = await many<{ id: string; kind: string; container_qty: string; lead_time_days: number; notes: string | null; is_active: boolean; item_id: string; code: string; name: string; uom: string; warehouse: string; warehouse_id: string; source_warehouse_id: string | null; source: string | null; vendor_id: string | null }>(
        tx,
        sql`select l.id, l.kind, l.container_qty::text, l.lead_time_days, l.notes, l.is_active, l.item_id, i.code, i.name, u.code as uom, w.code as warehouse, l.warehouse_id, l.source_warehouse_id, sw.code as source, l.vendor_id
            from kanban_loops l join items i on i.id = l.item_id join uoms u on u.id = i.base_uom_id join warehouses w on w.id = l.warehouse_id left join warehouses sw on sw.id = l.source_warehouse_id
            order by i.code, w.code`,
      );
      const cards = loops.length
        ? await many<{ id: string; loop_id: string; card_no: number; status: string; signalled_at: Date | null; doc_id: string | null; doc_number: string | null; doc_type: string | null; doc_status: string | null }>(
            tx,
            sql`select c.id, c.loop_id, c.card_no, c.status, c.signalled_at, c.doc_id, d.number as doc_number, d.doc_type, d.status as doc_status
                from kanban_cards c left join documents d on d.id = c.doc_id order by c.card_no`,
          )
        : [];
      return loops.map((l) => {
        const own = cards.filter((c) => c.loop_id === l.id);
        return {
          id: l.id,
          kind: l.kind,
          item: { id: l.item_id, code: l.code, name: l.name, uom: l.uom },
          warehouse: { id: l.warehouse_id, code: l.warehouse },
          sourceWarehouse: l.source_warehouse_id ? { id: l.source_warehouse_id, code: l.source } : null,
          vendorId: l.vendor_id,
          containerQty: l.container_qty,
          leadTimeDays: l.lead_time_days,
          notes: l.notes,
          isActive: l.is_active,
          cards: own.map((c) => ({ id: c.id, cardNo: c.card_no, status: c.status, signalledAt: c.signalled_at, doc: c.doc_id ? { id: c.doc_id, number: c.doc_number, docType: c.doc_type, status: c.doc_status } : null })),
          full: own.filter((c) => c.status === 'full').length,
        };
      });
    });
  }

  save(auth: AuthContext, id: string | null, input: LoopInput) {
    return this.database.run(auth, async (tx) => {
      const [it] = await tx.select({ id: items.id, isStock: items.isStockItem }).from(items).where(eq(items.id, input.itemId));
      if (!it || !it.isStock) throw new BadRequestException('Choose a stock item');
      if (input.kind === 'transfer' && !input.sourceWarehouseId) throw new BadRequestException('A transfer loop needs the store it is replenished from');
      if (input.kind === 'transfer' && input.sourceWarehouseId === input.warehouseId) throw new BadRequestException('The source store must differ from the point of use');
      const values = { itemId: input.itemId, kind: input.kind, warehouseId: input.warehouseId, sourceWarehouseId: input.kind === 'transfer' ? (input.sourceWarehouseId ?? null) : null, vendorId: input.vendorId ?? null, containerQty: input.containerQty, leadTimeDays: input.leadTimeDays, notes: input.notes, isActive: input.isActive };
      let loopId = id;
      if (id) {
        const [r] = await tx.update(kanbanLoops).set(values).where(eq(kanbanLoops.id, id)).returning({ id: kanbanLoops.id });
        if (!r) throw new NotFoundException('Kanban loop not found');
      } else {
        const [r] = await tx.insert(kanbanLoops).values({ tenantId: auth.tenantId, ...values }).returning({ id: kanbanLoops.id });
        loopId = r.id;
      }
      // Cards: add new ones as full; remove from the end only if they are full (in the rack).
      const cards = await tx.select().from(kanbanCards).where(eq(kanbanCards.loopId, loopId!)).orderBy(asc(kanbanCards.cardNo));
      if (input.cards > cards.length) {
        await tx.insert(kanbanCards).values(Array.from({ length: input.cards - cards.length }, (_, i) => ({ tenantId: auth.tenantId, loopId: loopId!, cardNo: cards.length + i + 1 })));
      } else if (input.cards < cards.length) {
        const extra = cards.slice(input.cards);
        if (extra.some((c) => c.status !== 'full')) throw new ConflictException('Cards out for replenishment cannot be removed: receive them first');
        for (const c of extra) await tx.delete(kanbanCards).where(eq(kanbanCards.id, c.id));
      }
      return { id: loopId };
    });
  }

  /** Average daily use at the point of use over the last 90 days, and the cards it needs. */
  suggest(auth: AuthContext, loopId: string) {
    return this.database.run(auth, async (tx) => {
      const [l] = await tx.select().from(kanbanLoops).where(eq(kanbanLoops.id, loopId));
      if (!l) throw new NotFoundException('Kanban loop not found');
      const [u] = await many<{ used: string }>(
        tx,
        sql`select coalesce(sum(-qty), 0)::text as used from stock_ledger
            where item_id = ${l.itemId} and warehouse_id = ${l.warehouseId} and qty < 0 and not is_reversal
              and posting_date > (now() at time zone 'Asia/Kolkata')::date - 90`,
      );
      const daily = Number(u.used) / 90;
      // Cover the lead time with 20 % safety, plus the container in use.
      const cards = daily > 0 ? Math.ceil((daily * Math.max(1, l.leadTimeDays) * 1.2) / Number(l.containerQty)) + 1 : null;
      return { dailyUsage: Math.round(daily * 100) / 100, cards };
    });
  }

  /** A card's code: `KB:<id>`. Scanning a full card signals it; scanning an empty one receives it. */
  async scan(auth: AuthContext, code: string, meta: RequestMeta) {
    const id = code.trim().replace(/^KB:/i, '');
    if (!z.uuid().safeParse(id).success) throw new BadRequestException('Not a kanban card code');
    const status = await this.database.run(auth, async (tx) => (await tx.select({ s: kanbanCards.status }).from(kanbanCards).where(eq(kanbanCards.id, id)))[0]?.s);
    if (!status) throw new NotFoundException('Kanban card not found');
    return status === 'full' ? this.signal(auth, id, meta) : this.receive(auth, id);
  }

  async signal(auth: AuthContext, cardId: string, meta: RequestMeta) {
    const ctx = await this.database.run(auth, async (tx) => {
      const [r] = await tx
        .select({ c: kanbanCards, l: kanbanLoops, code: items.code, name: items.name, baseUomId: items.baseUomId, uom: uoms.code, wh: warehouses.code })
        .from(kanbanCards)
        .innerJoin(kanbanLoops, eq(kanbanLoops.id, kanbanCards.loopId))
        .innerJoin(items, eq(items.id, kanbanLoops.itemId))
        .innerJoin(uoms, eq(uoms.id, items.baseUomId))
        .innerJoin(warehouses, eq(warehouses.id, kanbanLoops.warehouseId))
        .where(eq(kanbanCards.id, cardId));
      if (!r) throw new NotFoundException('Kanban card not found');
      // Claim the card first so a double scan raises one replenishment.
      const claimed = await tx.update(kanbanCards).set({ status: 'empty', signalledAt: new Date(), updatedAt: new Date() }).where(and(eq(kanbanCards.id, cardId), eq(kanbanCards.status, 'full'))).returning({ id: kanbanCards.id });
      if (!claimed.length) throw new ConflictException('The card has already been signalled');
      if (!r.l.isActive) throw new ConflictException('The kanban loop is inactive');
      return r;
    });
    const { l, c } = ctx;
    const label = `Kanban ${ctx.code} @ ${ctx.wh}, card ${c.cardNo}`;
    const due = addDays(todayIST(), l.leadTimeDays);
    try {
      if (auth.permissions && !auth.permissions.has(PERM[l.kind as keyof typeof PERM])) throw new ForbiddenException(`Missing permission: ${PERM[l.kind as keyof typeof PERM]}`);
      let doc: { id: string; displayNumber: string; docType: string };
      if (l.kind === 'production') {
        const w = await this.workOrders.create(auth, { kind: 'mts', itemId: l.itemId, bomId: null, formulaId: null, batchNo: null, qty: l.containerQty, salesOrderLineId: null, parentWorkOrderId: null, sourceWarehouseId: l.warehouseId, targetWarehouseId: l.warehouseId, plannedStart: todayIST(), plannedEnd: due, priority: 2, backflush: false, notes: label }, meta);
        doc = { id: w.id, displayNumber: w.displayNumber, docType: 'work_order' };
      } else if (l.kind === 'purchase') {
        const pr = await this.requisitions.create(auth, { priority: 'high', department: null, purpose: label, notes: null, requiredBy: due, lines: [{ itemId: l.itemId, uomId: ctx.baseUomId, itemCode: ctx.code, description: ctx.name, uom: ctx.uom, quantity: l.containerQty, estimatedRate: null, requiredBy: due, remarks: label }] }, meta);
        doc = { id: pr.id, displayNumber: pr.displayNumber, docType: 'purchase_requisition' };
      } else {
        const se = await this.stockEntries.create(auth, { purpose: 'transfer', fromWarehouseId: l.sourceWarehouseId, toWarehouseId: l.warehouseId, reason: null, reference: label.slice(0, 100), notes: null, lines: [{ itemId: l.itemId, qty: l.containerQty, rate: null, batchNo: null, remarks: null }] }, meta);
        doc = { id: se.id, displayNumber: se.displayNumber, docType: 'stock_entry' };
      }
      await this.database.run(auth, (tx) => tx.update(kanbanCards).set({ docId: doc.id }).where(eq(kanbanCards.id, cardId)));
      return { card: { id: cardId, cardNo: c.cardNo, status: 'empty' }, doc };
    } catch (e) {
      // Put the card back so it can be signalled again once the problem is fixed.
      await this.database.run(auth, (tx) => tx.update(kanbanCards).set({ status: 'full', signalledAt: null }).where(eq(kanbanCards.id, cardId)));
      throw e;
    }
  }

  receive(auth: AuthContext, cardId: string) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.update(kanbanCards).set({ status: 'full', signalledAt: null, updatedAt: new Date() }).where(and(eq(kanbanCards.id, cardId), eq(kanbanCards.status, 'empty'))).returning();
      if (!r) throw new ConflictException('The card is not out for replenishment');
      return { card: { id: r.id, cardNo: r.cardNo, status: r.status } };
    });
  }
}
