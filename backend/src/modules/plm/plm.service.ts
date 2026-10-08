import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { cadFiles, cadFileVersions, plmEboms, plmItemStates, type Transaction } from '@nextgen/database';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Readable } from 'node:stream';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService } from '../documents/documents.service';
import { StorageService } from '../documents/storage.service';
import { ESignService } from '../gmp/esign.service';
import { BomsService } from '../manufacturing/boms.service';
import { cadFormat, cadMetadata, canBuy, canSell, compareBoms, gateProblems, nextRevision, STAGES, type Stage } from './plm-rules';
import { many } from '../../common/sql';

const MAX_CAD = 100 * 1_048_576;

export const moveSchema = z.object({ itemId: z.uuid(), to: z.enum(STAGES), note: z.string().trim().max(500).nullable().optional(), password: z.string().min(1).max(200).optional() });
export const ebomSchema = z.object({
  itemId: z.uuid(),
  revision: z.string().trim().min(1).max(10),
  lines: z.array(z.object({ findNo: z.number().int().min(1).max(9999), itemId: z.uuid(), qty: z.number().positive(), refDes: z.string().trim().max(200).nullable().optional(), note: z.string().trim().max(300).nullable().optional() })).min(1).max(500),
});
export const releaseSchema = z.object({ password: z.string().min(1).max(200), reason: z.string().trim().max(500).nullable().optional() });
export const cadSchema = z.object({ number: z.string().trim().min(1).max(40), title: z.string().trim().min(2).max(200), itemId: z.uuid().nullable().optional(), metadata: z.record(z.string(), z.string().max(200)).default({}), references: z.array(z.uuid()).max(200).default([]) });

/**
 * PLM-lite: lifecycle stages of items with gates (release needs a released engineering BOM and CAD,
 * signed), obsolete and phased-out items kept off orders, engineering BOMs with revisions compared
 * with and turned into manufacturing BOMs, and the CAD vault with check-out / check-in, versions,
 * metadata, where-used and signed release.
 */
@Injectable()
export class PlmService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly storage: StorageService,
    private readonly esign: ESignService,
    private readonly boms: BomsService,
  ) {}

  onModuleInit() {
    const check = (lines: string, verb: 'buy' | 'sell') => async (tx: Transaction, _auth: AuthContext, doc: { id: string }) => {
      const bad = await many<{ code: string; stage: Stage }>(tx, sql`select i.code, s.stage from ${sql.raw(lines)} l join plm_item_states s on s.item_id = l.item_id join items i on i.id = l.item_id where l.${sql.raw(lines === 'purchase_order_lines' ? 'po_id' : lines === 'sales_order_lines' ? 'order_id' : 'invoice_id')} = ${doc.id}`);
      const blocked = bad.filter((b) => !(verb === 'buy' ? canBuy(b.stage) : canSell(b.stage)));
      if (blocked.length) throw new BadRequestException(`${blocked.map((b) => `${b.code} is ${b.stage.replace('_', '-')}`).join('; ')}: it cannot be ${verb === 'buy' ? 'bought' : 'sold'}`);
    };
    this.documents.addValidator('purchase_order', check('purchase_order_lines', 'buy'));
    this.documents.addValidator('sales_order', check('sales_order_lines', 'sell'));
    this.documents.addValidator('sales_invoice', check('sales_invoice_lines', 'sell'));
  }

  // ---- lifecycle ---------------------------------------------------------------------------------

  /** Items with a lifecycle (items never moved count as released). */
  states(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select s.item_id as "itemId", i.code, i.name, i.type, s.stage, s.updated_at as "updatedAt", s.history,
                   exists (select 1 from plm_eboms e where e.item_id = s.item_id and e.status = 'released') as "releasedEbom",
                   exists (select 1 from cad_files c where c.item_id = s.item_id and c.status = 'released') as "releasedCad"
            from plm_item_states s join items i on i.id = s.item_id order by s.updated_at desc`,
      ),
    );
  }

  move(auth: AuthContext, input: z.infer<typeof moveSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [item] = await many<{ id: string; code: string; type: string }>(tx, sql`select id, code, type from items where id = ${input.itemId}`);
      if (!item) throw new NotFoundException('Item not found');
      const [s] = await tx.select().from(plmItemStates).where(eq(plmItemStates.itemId, input.itemId));
      const from: Stage | null = (s?.stage as Stage) ?? null;
      if (from) {
        const [f] = await many<{ ebom: boolean; cad: boolean; demand: number; made: boolean }>(
          tx,
          sql`select exists (select 1 from plm_eboms where item_id = ${item.id} and status = 'released') as ebom,
                     exists (select 1 from cad_files where item_id = ${item.id} and status = 'released') as cad,
                     exists (select 1 from boms b join documents d on d.id = b.id where b.item_id = ${item.id} and d.status = 'approved') or ${item.type} in ('finished_good', 'semi_finished') as made,
                     ((select count(*) from purchase_order_lines l join documents d on d.id = l.po_id where l.item_id = ${item.id} and d.status in ('pending_approval', 'approved'))
                      + (select count(*) from sales_order_lines l join documents d on d.id = l.order_id where l.item_id = ${item.id} and d.status in ('pending_approval', 'approved')))::int as demand`,
        );
        const problems = gateProblems(from, input.to, { made: f.made, releasedEbom: f.ebom, releasedCad: f.cad, openDemand: f.demand });
        if (problems.length) throw new ConflictException(problems.join('; '));
      } else if (input.to !== 'concept' && input.to !== 'design') throw new ConflictException('A new item starts in concept or design');
      let signatureId: string | null = null;
      if (input.to === 'released') {
        if (!input.password) throw new BadRequestException('Release is signed: enter your password');
        signatureId = (await this.esign.sign(tx, auth, { entityType: 'item_release', entityId: item.id, meaning: `Item ${item.code} released`, reason: input.note ?? null, payload: { itemId: item.id, from, to: input.to }, password: input.password, ip: meta.ip })).id;
      }
      const [u] = await many<{ name: string }>(tx, sql`select full_name as name from users where id = ${auth.userId}`);
      const entry = { from, to: input.to, at: new Date().toISOString(), by: u?.name ?? '', note: input.note ?? null, signatureId };
      if (s) await tx.update(plmItemStates).set({ stage: input.to, history: [...s.history, entry], updatedAt: new Date() }).where(eq(plmItemStates.id, s.id));
      else await tx.insert(plmItemStates).values({ tenantId: auth.tenantId, itemId: item.id, stage: input.to, history: [entry] });
      return { itemId: item.id, stage: input.to };
    });
  }

  // ---- engineering BOM ---------------------------------------------------------------------------

  eboms(auth: AuthContext, itemId?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select e.id, e.item_id as "itemId", i.code, i.name, e.revision, e.status, jsonb_array_length(e.lines)::int as lines, e.mbom_id as "mbomId", e.created_at as "createdAt"
            from plm_eboms e join items i on i.id = e.item_id ${itemId ? sql`where e.item_id = ${itemId}` : sql``} order by i.code, e.created_at desc`,
      ),
    );
  }

  private async ebomView(tx: Transaction, id: string) {
    const [e] = await tx.select().from(plmEboms).where(eq(plmEboms.id, id));
    if (!e) throw new NotFoundException('Engineering BOM not found');
    const ids = [e.itemId, ...e.lines.map((l) => l.itemId)];
    const names = new Map((await many<{ id: string; label: string }>(tx, sql`select id, code || ' · ' || name as label from items where id in ${ids}`)).map((r) => [r.id, r.label]));
    const mbom = await many<{ itemId: string; qty: number }>(
      tx,
      sql`select l.item_id as "itemId", (l.qty / b.quantity)::float8 as qty from boms b join documents d on d.id = b.id join bom_lines l on l.bom_id = b.id
          where b.item_id = ${e.itemId} and d.status = 'approved' and b.is_default and l.kind = 'component'`,
    );
    const diff = mbom.length ? compareBoms(e.lines, mbom) : null;
    const label = <T extends { itemId: string }>(x: T) => ({ ...x, item: names.get(x.itemId) ?? x.itemId });
    return {
      ...e,
      item: names.get(e.itemId) ?? null,
      lines: e.lines.map(label),
      comparison: diff && { ...diff, onlyDesign: diff.onlyDesign.map(label), qtyDiffers: diff.qtyDiffers.map(label), onlyManufacturing: await this.labelAll(tx, diff.onlyManufacturing) },
    };
  }

  private async labelAll(tx: Transaction, rows: { itemId: string; qty: number }[]) {
    if (!rows.length) return [];
    const names = new Map((await many<{ id: string; label: string }>(tx, sql`select id, code || ' · ' || name as label from items where id in ${rows.map((r) => r.itemId)}`)).map((r) => [r.id, r.label]));
    return rows.map((r) => ({ ...r, item: names.get(r.itemId) ?? r.itemId }));
  }

  getEbom(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => this.ebomView(tx, id));
  }

  saveEbom(auth: AuthContext, input: z.infer<typeof ebomSchema>) {
    if (input.lines.some((l) => l.itemId === input.itemId)) throw new BadRequestException('An item cannot contain itself');
    return this.database.run(auth, async (tx) => {
      const [e] = await tx.select().from(plmEboms).where(and(eq(plmEboms.itemId, input.itemId), eq(plmEboms.revision, input.revision)));
      if (e && e.status !== 'draft') throw new ConflictException(`Revision ${input.revision} is ${e.status}: start the next revision`);
      if (e) {
        await tx.update(plmEboms).set({ lines: input.lines }).where(eq(plmEboms.id, e.id));
        return this.ebomView(tx, e.id);
      }
      const [r] = await tx
        .insert(plmEboms)
        .values({ tenantId: auth.tenantId, ...input, createdBy: auth.userId })
        .returning({ id: plmEboms.id });
      return this.ebomView(tx, r.id);
    });
  }

  /** Release a draft revision under signature; the previous released revision is superseded. */
  releaseEbom(auth: AuthContext, id: string, input: z.infer<typeof releaseSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const v = await this.ebomView(tx, id);
      if (v.status !== 'draft') throw new ConflictException('Only a draft can be released');
      const sig = await this.esign.sign(tx, auth, { entityType: 'ebom', entityId: id, meaning: `Engineering BOM ${v.item} revision ${v.revision} released`, reason: input.reason ?? null, payload: { itemId: v.itemId, revision: v.revision, lines: v.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })) }, password: input.password, ip: meta.ip });
      await tx.execute(sql`update plm_eboms set status = 'superseded' where item_id = ${v.itemId} and status = 'released'`);
      await tx.update(plmEboms).set({ status: 'released', releaseSignatureId: sig.id }).where(eq(plmEboms.id, id));
      return this.ebomView(tx, id);
    });
  }

  /** Draft a manufacturing BOM from a released engineering BOM (operations are added in manufacturing). */
  async toMbom(auth: AuthContext, id: string, meta: RequestMeta) {
    const v = await this.database.run(auth, (tx) => this.ebomView(tx, id));
    if (v.status !== 'released') throw new ConflictException('Release the engineering BOM first');
    if (v.mbomId) throw new ConflictException('A manufacturing BOM was already drafted from this revision');
    const bom = (await this.boms.create(auth, { itemId: v.itemId, quantity: '1', isDefault: true, drawingRevision: v.revision, notes: `From engineering BOM revision ${v.revision}`, lines: v.lines.map((l) => ({ kind: 'component', itemId: l.itemId, qty: String(l.qty), scrapPct: '0', isPhantom: false, priority: 1, remarks: l.refDes ?? null })), operations: [] } as never, meta)) as { id: string };
    return this.database.run(auth, async (tx) => {
      await tx.update(plmEboms).set({ mbomId: bom.id }).where(eq(plmEboms.id, id));
      return { ...(await this.ebomView(tx, id)), mbomId: bom.id };
    });
  }

  // ---- CAD vault ---------------------------------------------------------------------------------

  cadList(auth: AuthContext, q?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select c.id, c.number, c.title, c.format, c.revision, c.status, c.metadata, i.code as item, u.full_name as "checkedOutBy", c.checked_out_at as "checkedOutAt",
                   (select max(version) from cad_file_versions v where v.cad_file_id = c.id) as version
            from cad_files c left join items i on i.id = c.item_id left join users u on u.id = c.checked_out_by
            ${q ? sql`where c.number ilike ${`%${q}%`} or c.title ilike ${`%${q}%`} or c.metadata::text ilike ${`%${q}%`}` : sql``}
            order by c.number limit 300`,
      ),
    );
  }

  private async cadView(tx: Transaction, id: string) {
    const [c] = await tx.select().from(cadFiles).where(eq(cadFiles.id, id));
    if (!c) throw new NotFoundException('CAD file not found');
    const versions = await many(tx, sql`select v.id, v.version, v.revision, v.file_name as "fileName", v.size_bytes as "sizeBytes", v.sha256, v.note, u.full_name as "uploadedBy", v.created_at as "createdAt" from cad_file_versions v left join users u on u.id = v.uploaded_by where v.cad_file_id = ${id} order by v.version desc`);
    const uses = c.references.length ? await many(tx, sql`select id, number, title, revision, status from cad_files where id in ${c.references}`) : [];
    const usedIn = await many(tx, sql`select id, number, title, revision, status from cad_files where ${id}::uuid = any("references")`);
    const [holder] = c.checkedOutBy ? await many<{ name: string }>(tx, sql`select full_name as name from users where id = ${c.checkedOutBy}`) : [];
    return { ...c, checkedOutByName: holder?.name ?? null, versions, uses, usedIn };
  }

  getCad(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => this.cadView(tx, id));
  }

  /** A new vault entry, checked out to its creator so the first version can be uploaded. */
  createCad(auth: AuthContext, input: z.infer<typeof cadSchema>) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx
        .insert(cadFiles)
        .values({ tenantId: auth.tenantId, ...input, itemId: input.itemId ?? null, format: 'other', checkedOutBy: auth.userId, checkedOutAt: new Date() })
        .onConflictDoNothing()
        .returning({ id: cadFiles.id });
      if (!r) throw new ConflictException('This number is in the vault');
      return this.cadView(tx, r.id);
    });
  }

  checkOut(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.select().from(cadFiles).where(eq(cadFiles.id, id));
      if (!c) throw new NotFoundException('CAD file not found');
      if (c.status === 'obsolete') throw new ConflictException('The file is obsolete');
      if (c.checkedOutBy && c.checkedOutBy !== auth.userId) throw new ConflictException('Someone else has the file checked out');
      // Working on a released file starts the next revision.
      const revision = c.status === 'released' ? nextRevision(c.revision) : c.revision;
      await tx.update(cadFiles).set({ checkedOutBy: auth.userId, checkedOutAt: new Date(), status: 'in_work', revision, releaseSignatureId: c.status === 'released' ? null : c.releaseSignatureId }).where(eq(cadFiles.id, id));
      return this.cadView(tx, id);
    });
  }

  undoCheckOut(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.select().from(cadFiles).where(eq(cadFiles.id, id));
      if (!c) throw new NotFoundException('CAD file not found');
      if (c.checkedOutBy !== auth.userId) throw new ForbiddenException('Only the person who checked the file out can release it');
      await tx.update(cadFiles).set({ checkedOutBy: null, checkedOutAt: null }).where(eq(cadFiles.id, id));
      return this.cadView(tx, id);
    });
  }

  /** Check in a new version: the uploader must hold the check-out; metadata is read from DXF and STEP files. */
  async checkIn(auth: AuthContext, id: string, file: { filename: string; file: Readable }, note: string | null) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const ch of file.file) {
      size += (ch as Buffer).length;
      if (size > MAX_CAD) throw new BadRequestException('CAD files are limited to 100 MB');
      chunks.push(ch as Buffer);
    }
    const buf = Buffer.concat(chunks);
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.select().from(cadFiles).where(eq(cadFiles.id, id));
      if (!c) throw new NotFoundException('CAD file not found');
      if (c.checkedOutBy !== auth.userId) throw new ConflictException('Check the file out before checking in a new version');
      const stored = await this.storage.put(auth.tenantId, Readable.from(buf), MAX_CAD);
      const [{ n }] = await many<{ n: number }>(tx, sql`select coalesce(max(version), 0)::int + 1 as n from cad_file_versions where cad_file_id = ${id}`);
      await tx.insert(cadFileVersions).values({ tenantId: auth.tenantId, cadFileId: id, version: n, revision: c.revision, fileName: file.filename, sizeBytes: stored.sizeBytes, sha256: stored.sha256, storageKey: stored.key, note, uploadedBy: auth.userId });
      await tx
        .update(cadFiles)
        .set({ format: cadFormat(file.filename), metadata: { ...c.metadata, ...cadMetadata(file.filename, buf) }, checkedOutBy: null, checkedOutAt: null })
        .where(eq(cadFiles.id, id));
      return this.cadView(tx, id);
    });
  }

  releaseCad(auth: AuthContext, id: string, input: z.infer<typeof releaseSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const v = await this.cadView(tx, id);
      if (v.status !== 'in_work') throw new ConflictException(`The file is ${v.status}`);
      if (v.checkedOutBy) throw new ConflictException('Check the file in first');
      if (!v.versions.length) throw new ConflictException('Upload a version first');
      const unreleased = v.uses.filter((u) => (u as { status: string }).status !== 'released');
      if (unreleased.length) throw new ConflictException(`Release the files it uses first: ${unreleased.map((u) => (u as { number: string }).number).join(', ')}`);
      const latest = v.versions[0] as { version: number; sha256: string };
      const sig = await this.esign.sign(tx, auth, { entityType: 'cad_file', entityId: id, meaning: `${v.number} revision ${v.revision} released`, reason: input.reason ?? null, payload: { number: v.number, revision: v.revision, version: latest.version, sha256: latest.sha256 }, password: input.password, ip: meta.ip });
      await tx.update(cadFiles).set({ status: 'released', releaseSignatureId: sig.id }).where(eq(cadFiles.id, id));
      return this.cadView(tx, id);
    });
  }

  async downloadCad(auth: AuthContext, versionId: string) {
    const [v] = await this.database.run(auth, (tx) => tx.select().from(cadFileVersions).where(eq(cadFileVersions.id, versionId)).orderBy(desc(cadFileVersions.version)));
    if (!v) throw new NotFoundException('Version not found');
    return { stream: await this.storage.open(v.storageKey), fileName: v.fileName, sizeBytes: v.sizeBytes };
  }
}
