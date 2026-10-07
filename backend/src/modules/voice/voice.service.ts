import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { aiVoiceLogs, type Transaction } from '@nextgen/database';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { AiGateway } from '../ai-gov/ai-gateway.service';
import { CopilotService } from '../copilot/copilot.service';
import { createWorkOrderSchema, WorkOrdersService } from '../manufacturing/work-orders.service';
import { createRequisitionSchema } from '../purchase/requisitions.schemas';
import { RequisitionsService } from '../purchase/requisitions.service';
import { scoreEval } from './eval-set';
import { parseCommand, VOICE_LANGUAGES } from './grammar';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const LANGS = VOICE_LANGUAGES.map((l) => l.code) as [string, ...string[]];
/** JSON with sorted keys, so values stored as jsonb (which reorders keys) compare equal. */
const stable = (v: unknown): string => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v));

export const interpretSchema = z.object({ text: z.string().trim().min(1).max(500), lang: z.enum(LANGS).default('en-IN') });
export const executeSchema = z.object({
  logId: z.uuid(),
  command: z.enum(['work_order', 'requisition']),
  params: z.record(z.string(), z.unknown()),
});

type Reply = {
  logId: string;
  kind: 'confirm' | 'answer' | 'clarify';
  reply: string;
  command?: 'work_order' | 'requisition' | 'stock' | null;
  params?: Record<string, unknown>;
  summary?: { label: string; value: string }[];
  notes?: string[];
  data?: unknown;
};

/** Speech is recognised in the browser; this turns the words into a draft to confirm, an answer, or a question back. */
@Injectable()
export class VoiceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly copilot: CopilotService,
    private readonly gateway: AiGateway,
    private readonly workOrders: WorkOrdersService,
    private readonly requisitions: RequisitionsService,
  ) {}

  private hi(lang: string) {
    return lang.startsWith('hi') || lang.startsWith('mr');
  }

  /** Items whose name or code contains the words, best first (whole-name matches, then shortest). */
  private async findItems(tx: Transaction, words: string, stockOnly: boolean) {
    const variants = [...new Set([words, words.replace(/(es|s)$/, ''), words.replace(/\s+/g, '')])].filter((v) => v.length >= 2);
    return many<{ id: string; code: string; name: string; uom: string; uomId: string; type: string }>(
      tx,
      sql`select i.id, i.code, i.name, u.code as uom, i.base_uom_id as "uomId", i.type from items i join uoms u on u.id = i.base_uom_id
          where i.is_active and i.deleted_at is null ${stockOnly ? sql`and i.is_stock_item` : sql``}
            and (${sql.join(variants.map((v) => sql`i.name ilike ${`%${v}%`} or i.code ilike ${v}`), sql` or `)})
          order by (lower(i.name) = lower(${words})) desc, length(i.name) limit 3`,
    );
  }

  async interpret(auth: AuthContext, input: z.infer<typeof interpretSchema>): Promise<Reply> {
    await this.gateway.assertEnabled(auth.tenantId, 'voice');
    const p = parseCommand(input.text);
    const hi = this.hi(input.lang);
    const log = async (outcome: string, extra: Partial<typeof aiVoiceLogs.$inferInsert> = {}) =>
      (await this.database.run(auth, (tx) => tx.insert(aiVoiceLogs).values({ tenantId: auth.tenantId, userId: auth.userId, lang: input.lang, text: input.text, normalised: p.normalised, command: p.command, parsed: p as unknown as Record<string, unknown>, outcome, ...extra }).returning({ id: aiVoiceLogs.id })))[0].id;

    if (p.command === 'stock') {
      if (!p.item) return { logId: await log('failed'), kind: 'clarify', reply: hi ? 'किस आइटम का स्टॉक?' : 'Stock of which item?' };
      const rows = await this.database.run(auth, async (tx) => {
        const found = await this.findItems(tx, p.item!, true);
        return Promise.all(
          found.map(async (i) => {
            const [s] = await many<{ qty: string }>(tx, sql`select coalesce(sum(b.qty), 0)::text as qty from stock_balances b join warehouses w on w.id = b.warehouse_id where b.item_id = ${i.id} and w.is_nettable`);
            return { ...i, qty: Number(s.qty) };
          }),
        );
      });
      if (!rows.length) return { logId: await log('failed'), kind: 'clarify', reply: hi ? `"${p.item}" नाम का कोई आइटम नहीं मिला।` : `I could not find an item called "${p.item}".` };
      const top = rows[0];
      const reply = hi ? `${top.name} का स्टॉक ${top.qty.toLocaleString('en-IN')} ${top.uom} है।` : `${top.name}: ${top.qty.toLocaleString('en-IN')} ${top.uom} in stock.`;
      return { logId: await log('understood'), kind: 'answer', command: 'stock', reply, data: rows };
    }

    if (p.command === 'work_order') {
      const r = await this.database.run(auth, async (tx) => {
        const notes: string[] = [];
        let item: { id: string; code: string; name: string; uom: string } | null = null;
        let lineWc: { id: string; code: string; name: string } | null = null;
        let lastWo: { itemId: string; source: string; target: string } | null = null;
        if (p.line) {
          const num = p.line.replace(/^Line\s+/i, '');
          [lineWc] = await many<{ id: string; code: string; name: string }>(
            tx,
            sql`select id, code, name from work_centers where name ilike ${`%line ${num}%`} or name ilike ${`%line-${num}%`} or code ilike ${`L${num}`} or code ilike ${`LINE${num}`} or code ilike ${`LINE-${num}`} order by (kind = 'line') desc limit 1`,
          );
          if (!lineWc) notes.push(hi ? `${p.line} नाम का कोई वर्क सेंटर नहीं मिला।` : `No work centre called ${p.line} was found.`);
          if (lineWc) {
            [lastWo] = await many<{ itemId: string; source: string; target: string }>(
              tx,
              sql`select wo.item_id as "itemId", wo.source_warehouse_id as source, wo.target_warehouse_id as target from work_orders wo join documents d on d.id = wo.id
                  where exists (select 1 from work_order_operations op where op.work_order_id = wo.id and op.work_center_id = ${lineWc.id}) order by d.doc_date desc, d.created_at desc limit 1`,
            );
          }
        }
        if (p.item) {
          [item] = await this.findItems(tx, p.item, true);
          if (!item) return { clarify: hi ? `"${p.item}" नाम का कोई आइटम नहीं मिला। कौन सा आइटम बनाना है?` : `I could not find "${p.item}". Which item should be made?` };
        } else if (lastWo) {
          [item] = await many<{ id: string; code: string; name: string; uom: string }>(tx, sql`select i.id, i.code, i.name, u.code as uom from items i join uoms u on u.id = i.base_uom_id where i.id = ${lastWo.itemId}`);
          notes.push(hi ? `आइटम ${p.line} के पिछले ऑर्डर से लिया गया: ${item.code}` : `Item taken from the last order on ${p.line}: ${item.code}. Change it before confirming if needed.`);
        }
        if (!item) return { clarify: hi ? 'कौन सा आइटम बनाना है?' : 'Which item should be made?' };
        if (!p.qty) return { clarify: hi ? `${item.name} कितने बनाने हैं?` : `How many ${item.name}?` };
        const [wh] = await many<{ id: string }>(tx, sql`select id from warehouses where is_active and is_nettable order by (code = 'MAIN') desc, code limit 1`);
        const source = lastWo?.source ?? wh?.id;
        const target = lastWo?.target ?? wh?.id;
        if (!source) return { clarify: hi ? 'कोई स्टोर नहीं मिला।' : 'No warehouse is set up.' };
        const params = { itemId: item.id, qty: String(p.qty), sourceWarehouseId: source, targetWarehouseId: target, plannedStart: todayIST(), notes: `Voice: ${input.text}` };
        return { item, params, notes };
      });
      if ('clarify' in r) return { logId: await log('failed'), kind: 'clarify', reply: r.clarify! };
      const reply = hi ? `${p.line ? `${p.line} के लिए ` : ''}${r.item.name} के ${p.qty!.toLocaleString('en-IN')} ${r.item.uom} का प्रोडक्शन ऑर्डर बनाऊँ?` : `Create a production order for ${p.qty!.toLocaleString('en-IN')} ${r.item.uom} of ${r.item.name}${p.line ? ` on ${p.line}` : ''}?`;
      return {
        logId: await log('understood', { parsed: { ...p, params: r.params } as unknown as Record<string, unknown> }),
        kind: 'confirm',
        command: 'work_order',
        reply,
        params: r.params,
        summary: [
          { label: hi ? 'आइटम' : 'Item', value: `${r.item.code} · ${r.item.name}` },
          { label: hi ? 'मात्रा' : 'Quantity', value: `${p.qty!.toLocaleString('en-IN')} ${r.item.uom}` },
          ...(p.line ? [{ label: hi ? 'लाइन' : 'Line', value: p.line }] : []),
          { label: hi ? 'शुरुआत' : 'Start', value: todayIST() },
        ],
        notes: r.notes,
      };
    }

    if (p.command === 'requisition') {
      const found = p.item ? await this.database.run(auth, (tx) => this.findItems(tx, p.item!, false)) : [];
      if (!p.item || !found.length) return { logId: await log('failed'), kind: 'clarify', reply: hi ? 'कौन सा आइटम मंगवाना है?' : 'Which item should be requested?' };
      if (!p.qty) return { logId: await log('failed'), kind: 'clarify', reply: hi ? `${found[0].name} कितना मंगवाना है?` : `How much ${found[0].name}?` };
      const it = found[0];
      const notes = p.unit && p.unit !== 'units' && !it.uom.toLowerCase().startsWith(p.unit.slice(0, 2)) ? [hi ? `आपने ${p.unit} कहा; आइटम की इकाई ${it.uom} है।` : `You said ${p.unit}; the item is kept in ${it.uom}. The request uses ${it.uom}.`] : [];
      const params = { purpose: `Voice request: ${input.text}`, priority: 'normal', lines: [{ itemId: it.id, uomId: it.uomId, description: it.name, uom: it.uom, quantity: String(p.qty) }] };
      return {
        logId: await log('understood', { parsed: { ...p, params } as unknown as Record<string, unknown> }),
        kind: 'confirm',
        command: 'requisition',
        reply: hi ? `${it.name} के ${p.qty.toLocaleString('en-IN')} ${it.uom} का इंडेंट बनाऊँ?` : `Raise a requisition for ${p.qty.toLocaleString('en-IN')} ${it.uom} of ${it.name}?`,
        params,
        summary: [
          { label: hi ? 'आइटम' : 'Item', value: `${it.code} · ${it.name}` },
          { label: hi ? 'मात्रा' : 'Quantity', value: `${p.qty.toLocaleString('en-IN')} ${it.uom}` },
        ],
        notes,
      };
    }

    // Not a command: the copilot answers (with the model when a key is set, by rules otherwise).
    const ans = await this.copilot.chat(auth, { messages: [{ role: 'user', content: input.text }], language: hi ? 'hi' : input.lang.startsWith('en') ? 'en' : 'auto' });
    return { logId: await log('fallback'), kind: 'answer', command: null, reply: ans.reply, data: ans };
  }

  /** Creates the confirmed draft with the person's own permissions. */
  async execute(auth: AuthContext, input: z.infer<typeof executeSchema>, meta: RequestMeta) {
    const [l] = await this.database.run(auth, (tx) => tx.select().from(aiVoiceLogs).where(and(eq(aiVoiceLogs.id, input.logId), eq(aiVoiceLogs.userId, auth.userId))));
    if (!l) throw new NotFoundException('Voice command not found');
    if (l.outcome !== 'understood') throw new BadRequestException(`This command was already ${l.outcome}`);
    const perms = await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId);
    const need = input.command === 'work_order' ? 'manufacturing.production.manage' : 'purchase.requisitions.manage';
    if (!perms.has(need)) throw new ForbiddenException(`Needs ${need}`);
    let doc: { id: string; number?: string | null };
    try {
      doc = input.command === 'work_order'
        ? ((await this.workOrders.create(auth, createWorkOrderSchema.parse(input.params), meta)) as { id: string })
        : ((await this.requisitions.create(auth, createRequisitionSchema.parse(input.params), meta)) as { id: string });
    } catch (e) {
      await this.database.run(auth, (tx) => tx.update(aiVoiceLogs).set({ outcome: 'failed' }).where(eq(aiVoiceLogs.id, l.id)));
      throw e;
    }
    // A change made on the confirm screen counts as a correction for the accuracy figure.
    const changed = stable(input.params) !== stable(((l.parsed ?? {}) as Record<string, unknown>).params ?? input.params);
    await this.database.run(auth, (tx) => tx.update(aiVoiceLogs).set({ outcome: changed ? 'corrected' : 'executed', documentId: doc.id }).where(eq(aiVoiceLogs.id, l.id)));
    return { id: doc.id, link: input.command === 'work_order' ? `/manufacturing/work-orders/${doc.id}` : `/purchase/requisitions/${doc.id}` };
  }

  cancel(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      await tx.update(aiVoiceLogs).set({ outcome: 'cancelled' }).where(and(eq(aiVoiceLogs.id, id), eq(aiVoiceLogs.userId, auth.userId), eq(aiVoiceLogs.outcome, 'understood')));
      return { ok: true };
    });
  }

  /** Field accuracy from real use, and the parser's score on the evaluation set. */
  stats(auth: AuthContext, days: number) {
    return this.database.run(auth, async (tx) => {
      const byOutcome = await many<{ lang: string; command: string | null; outcome: string; n: number }>(
        tx,
        sql`select lang, command, outcome, count(*)::int as n from ai_voice_logs where created_at > now() - make_interval(days => ${days}::int) group by 1, 2, 3 order by 1, 2, 3`,
      );
      const commands = byOutcome.filter((r) => r.command && r.command !== 'stock');
      const confirmed = commands.filter((r) => r.outcome === 'executed').reduce((s, r) => s + r.n, 0);
      const decided = commands.filter((r) => ['executed', 'corrected', 'cancelled'].includes(r.outcome)).reduce((s, r) => s + r.n, 0);
      return { days, byOutcome, fieldAccuracyPct: decided ? Math.round((confirmed / decided) * 1000) / 10 : null, evalSet: scoreEval(parseCommand), languages: VOICE_LANGUAGES };
    });
  }
}
