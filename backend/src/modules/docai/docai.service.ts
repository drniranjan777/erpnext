import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { aiDocCaptures, itemVendors, type Transaction } from '@nextgen/database';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { loadPermissions } from '../../common/guards';
import type { Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { extractDocument, type DocKind, type Extracted } from './extractors';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const KINDS = ['delivery_challan', 'eway_bill', 'coa', 'quotation', 'bank_statement', 'invoice', 'unknown'] as const;
export const textSchema = z.object({ text: z.string().min(10).max(200_000), kind: z.enum(KINDS).optional(), fileName: z.string().max(200).optional() });

/**
 * Document AI: reads delivery challans, e-way bills, certificates of analysis, vendor quotations
 * and bank statements. Text is read directly; scans, photos and handwriting are transcribed by the
 * model (when a key is set) and then read the same way. Each read is matched to parties, items
 * and documents, kept for review, and (quotations, CoAs) can be applied.
 */
@Injectable()
export class DocAiService {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService<Env, true>,
  ) {
    this.apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });
    this.model = config.get('AI_MODEL', { infer: true });
  }

  /** Plain text of a file: text files directly; PDFs and images through the model. */
  private async textOf(file: { buffer: Buffer; mimeType: string; name: string }): Promise<{ text: string; source: 'text' | 'ai' }> {
    if (file.mimeType.startsWith('text/') || /\.(txt|csv)$/i.test(file.name)) return { text: file.buffer.toString('utf8'), source: 'text' };
    if (!this.apiKey) throw new UnprocessableEntityException('Reading scans, photos and PDFs needs AI (set ANTHROPIC_API_KEY). Paste or upload the document as text instead.');
    const data = file.buffer.toString('base64');
    const block = file.mimeType === 'application/pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } : { type: 'image', source: { type: 'base64', media_type: file.mimeType, data } };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              block,
              { type: 'text', text: 'Transcribe this business document (it may be handwritten) as plain text, line by line as printed. Keep table rows on one line with cells separated by two spaces. Keep numbers, dates, GSTINs and codes exactly; write [unclear] for anything you cannot read. Output only the transcription.' },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new UnprocessableEntityException(`Could not read the document (AI ${res.status})`);
    const body = (await res.json()) as { content: { type: string; text?: string }[] };
    return { text: body.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'), source: 'ai' };
  }

  /** Links what was read to records: parties by GSTIN, items by name, documents by number. */
  private async match(tx: Transaction, r: Extracted) {
    const m: Record<string, unknown> = {};
    for (const key of ['fromGstin', 'toGstin', 'vendorGstin', 'supplierGstin']) {
      const g = r.fields[key];
      if (typeof g !== 'string') continue;
      const [p] = await many<{ id: string; name: string }>(tx, sql`select id, name from parties where gstin = ${g} and deleted_at is null limit 1`);
      if (p) m[key.replace('Gstin', 'Party')] = p;
    }
    const items: (Record<string, unknown> | null)[] = [];
    for (const l of r.lines) {
      const desc = String(l.description ?? l.parameter ?? '').trim();
      if (!desc || r.kind === 'coa' || r.kind === 'bank_statement') {
        items.push(null);
        continue;
      }
      const words = desc.split(/\s+/).slice(0, 3).join(' ');
      const [it] = await many<{ id: string; code: string; name: string }>(
        tx,
        sql`select id, code, name from items where deleted_at is null and (name ilike ${`%${words}%`} or code ilike ${desc.split(/\s+/)[0]} or ${desc} ilike '%' || name || '%') order by length(name) desc limit 1`,
      );
      items.push(it ?? null);
    }
    if (items.some(Boolean)) m.items = items;
    for (const key of ['documentNo', 'poRef']) {
      const n = r.fields[key];
      if (typeof n !== 'string') continue;
      const [d] = await many<{ id: string; number: string; docType: string; status: string }>(tx, sql`select id, number, doc_type as "docType", status from documents where number = ${n} limit 1`);
      if (d) m[key.replace(/No|Ref/, 'Document')] = d;
    }
    if (r.kind === 'coa' && typeof r.fields.batchNo === 'string') {
      const insp = await many<{ id: string; number: string | null; item: string; result: string }>(
        tx,
        sql`select q.id, d.number, i.code as item, q.result from quality_inspections q join documents d on d.id = q.id join items i on i.id = q.item_id
            where upper(q.batch_no) = upper(${r.fields.batchNo}) and q.stage = 'incoming' order by d.created_at desc limit 3`,
      );
      if (insp.length) m.inspections = insp;
    }
    if (r.kind === 'eway_bill' && m.documentDocument) {
      const d = m.documentDocument as { id: string; docType: string };
      if (d.docType === 'sales_invoice') {
        const [si] = await many<{ vehicleNo: string | null; ewayBillNo: string | null; total: string }>(tx, sql`select vehicle_no as "vehicleNo", eway_bill_no as "ewayBillNo", grand_total::text as total from sales_invoices where id = ${d.id}`);
        const checks: string[] = [];
        if (si?.ewayBillNo && si.ewayBillNo !== r.fields.ewbNo) checks.push(`The invoice carries e-way bill ${si.ewayBillNo}`);
        if (si?.vehicleNo && r.fields.vehicleNo && si.vehicleNo.replace(/\s/g, '') !== r.fields.vehicleNo) checks.push(`The invoice vehicle is ${si.vehicleNo}`);
        if (si && typeof r.fields.value === 'number' && Math.abs(Number(si.total) - r.fields.value) > 1) checks.push(`Value differs from the invoice total ₹${si.total}`);
        m.checks = checks;
      }
    }
    return m;
  }

  async read(auth: AuthContext, input: { text?: string; file?: { buffer: Buffer; mimeType: string; name: string }; kind?: DocKind; fileName?: string }) {
    const got = input.file ? await this.textOf(input.file) : { text: input.text ?? '', source: 'text' as const };
    if (got.text.trim().length < 10) throw new BadRequestException('The document is empty');
    const r = extractDocument(got.text, input.kind);
    return this.database.run(auth, async (tx) => {
      const matches = await this.match(tx, r);
      const [c] = await tx
        .insert(aiDocCaptures)
        .values({ tenantId: auth.tenantId, kind: r.kind, fileName: input.file?.name ?? input.fileName ?? null, source: got.source, confidence: r.confidence.toFixed(2), fields: r.fields, lines: r.lines, matches, warnings: [...r.warnings, ...((matches.checks as string[] | undefined) ?? [])], createdBy: auth.userId })
        .returning();
      return c;
    });
  }

  list(auth: AuthContext, status?: string) {
    return this.database.run(auth, (tx) =>
      many(tx, sql`select c.id, c.kind, c.file_name as "fileName", c.source, c.confidence, c.status, c.fields, jsonb_array_length(c.lines) as lines, jsonb_array_length(c.warnings) as warnings, c.created_at as "createdAt", u.full_name as "createdBy" from ai_doc_captures c left join users u on u.id = c.created_by where c.status = ${status ?? 'review'} order by c.created_at desc limit 200`),
    );
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.select().from(aiDocCaptures).where(eq(aiDocCaptures.id, id));
      if (!c) throw new NotFoundException('Capture not found');
      return c;
    });
  }

  discard(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.update(aiDocCaptures).set({ status: 'discarded' }).where(and(eq(aiDocCaptures.id, id), eq(aiDocCaptures.status, 'review'))).returning({ id: aiDocCaptures.id });
      if (!c) throw new ConflictException('Only a capture under review can be discarded');
      return { ok: true };
    });
  }

  /**
   * Applies a capture: a quotation updates the vendor's last rate for each matched item; a CoA is
   * attached to the incoming inspection of that batch (marked verified only if every result passes).
   */
  async apply(auth: AuthContext, id: string) {
    const perms = await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId);
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.select().from(aiDocCaptures).where(eq(aiDocCaptures.id, id)).for('update');
      if (!c) throw new NotFoundException('Capture not found');
      if (c.status !== 'review') throw new ConflictException(`Already ${c.status}`);
      const m = c.matches as { vendorParty?: { id: string; name: string }; fromParty?: { id: string }; items?: ({ id: string; code: string } | null)[]; inspections?: { id: string; number: string | null; result: string }[] };
      let result: Record<string, unknown>;
      if (c.kind === 'quotation') {
        if (!perms.has('purchase.orders.manage')) throw new ForbiddenException('Needs purchase.orders.manage');
        const vendor = m.vendorParty ?? m.fromParty;
        if (!vendor) throw new BadRequestException('The vendor was not matched (no known GSTIN on the quotation)');
        const updates: { item: string; rate: number }[] = [];
        for (const [i, line] of c.lines.entries()) {
          const it = m.items?.[i];
          const rate = Number(line.rate);
          if (!it || !(rate > 0)) continue;
          await tx
            .insert(itemVendors)
            .values({ tenantId: auth.tenantId, itemId: it.id, vendorId: vendor.id, lastRate: rate.toFixed(4), notes: `Quotation ${String(c.fields.quoteNo ?? '')} ${c.fields.validUntil ? `valid until ${c.fields.validUntil}` : ''}`.trim() })
            .onConflictDoUpdate({ target: [itemVendors.tenantId, itemVendors.itemId, itemVendors.vendorId], set: { lastRate: rate.toFixed(4), notes: sql`excluded.notes` } });
          updates.push({ item: it.code, rate });
        }
        if (!updates.length) throw new BadRequestException('No priced line was matched to an item');
        result = { vendor: vendor.id, updated: updates };
      } else if (c.kind === 'coa') {
        if (!perms.has('quality.inspections.manage')) throw new ForbiddenException('Needs quality.inspections.manage');
        const target = m.inspections?.find((x) => x.result === 'pending') ?? m.inspections?.[0];
        if (!target) throw new BadRequestException('No incoming inspection was found for this batch');
        const ok = c.fields.conclusion === 'complies';
        await tx.execute(sql`update quality_inspections set vendor_coa_ref = ${`CoA ${String(c.fields.batchNo)}`}, coa_verified = ${ok} where id = ${target.id}`);
        result = { inspectionId: target.id, coaVerified: ok };
      } else {
        throw new BadRequestException(c.kind === 'bank_statement' ? 'Import bank statements from Accounting → Bank reconciliation' : 'There is nothing to apply for this kind of document; use what was read to check the record');
      }
      await tx.update(aiDocCaptures).set({ status: 'applied', result, appliedBy: auth.userId, appliedAt: new Date() }).where(eq(aiDocCaptures.id, id));
      return { ok: true, ...result };
    });
  }
}
