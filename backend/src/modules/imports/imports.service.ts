import { BadRequestException, Injectable } from '@nestjs/common';
import { itemGroups, type Transaction, uoms, warehouses } from '@nextgen/database';
import { asc } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { SetupService } from '../masters/setup.service';
import { buildTemplate, parseSheet, type ParsedSheet } from './file-parser';
import {
  errorsFrom,
  ItemsImporter,
  OpeningStockImporter,
  PartiesImporter,
  type Importer,
  type ImportOptions,
  type ImportRow,
  type RowResult,
  type RunContext,
} from './importers';
import { parseTally, uniqueCode } from './tally';
import { unitKey } from './values';

export type SheetEntity = 'items' | 'parties' | 'opening_stock';

export interface Summary {
  total: number;
  created: number;
  skipped: number;
  errors: number;
}

export interface SheetResult {
  entity: SheetEntity;
  title: string;
  fileName: string;
  committed: boolean;
  summary: Summary;
  /** Headers in the file that didn't match any column. */
  ignoredColumns: string[];
  rows: RowResult[];
}

export interface TallySection {
  key: 'units' | 'groups' | 'warehouses' | 'items' | 'parties' | 'opening_stock';
  title: string;
  summary: Summary;
  rows: RowResult[];
}

export interface TallyResult {
  fileName: string;
  committed: boolean;
  summary: Summary;
  sections: TallySection[];
  warnings: string[];
  ignored: { ledgers: number; compoundUnits: number };
}

export interface TallyOptions extends ImportOptions {
  includeParties?: boolean;
  includeOpeningStock?: boolean;
  /** Applied to stock items that have no GST rate in Tally (neither on the item nor its group). */
  defaultGstRate?: string;
}

/** Thrown to roll back a dry run (or a commit with errors) while keeping the results. */
class Rollback<T> extends Error {
  constructor(readonly result: T) {
    super('rollback');
  }
}

export const summarise = (rows: RowResult[]): Summary => ({
  total: rows.length,
  created: rows.filter((r) => r.status === 'created').length,
  skipped: rows.filter((r) => r.status === 'skipped').length,
  errors: rows.filter((r) => r.status === 'error').length,
});

@Injectable()
export class ImportsService {
  private readonly importers: Record<SheetEntity, Importer>;

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly setup: SetupService,
    private readonly itemsImporter: ItemsImporter,
    private readonly partiesImporter: PartiesImporter,
    private readonly openingImporter: OpeningStockImporter,
  ) {
    this.importers = { items: itemsImporter, parties: partiesImporter, opening_stock: openingImporter };
  }

  columns(entity: SheetEntity) {
    const imp = this.importers[entity];
    return { entity, title: imp.title, columns: imp.columns.map(({ aliases: _a, ...c }) => c) };
  }

  async template(entity: SheetEntity, format: 'xlsx' | 'csv') {
    const imp = this.importers[entity];
    const name = `${entity.replace('_', '-')}-import-template`;
    if (format === 'csv') {
      const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      const header = imp.columns.map((c) => esc(c.required ? `${c.label} *` : c.label)).join(',');
      const example = imp.columns.map((c) => esc(c.example ?? '')).join(',');
      return { fileName: `${name}.csv`, contentType: 'text/csv; charset=utf-8', body: Buffer.from(`﻿${header}\r\n${example}\r\n`, 'utf8') };
    }
    return {
      fileName: `${name}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: await buildTemplate(imp.title, imp.columns, imp.lists()),
    };
  }

  /** Validates (commit = false) or imports a spreadsheet. Rows with errors never import. */
  async sheet(
    auth: AuthContext,
    entity: SheetEntity,
    file: { buffer: Buffer; fileName: string },
    options: ImportOptions & { skipInvalid?: boolean },
    commit: boolean,
    meta: RequestMeta,
  ): Promise<SheetResult> {
    const imp = this.importers[entity];
    const parsed = await parseSheet(file.buffer, file.fileName);
    const { rows, ignoredColumns } = this.mapColumns(imp, parsed);
    const opts = { ...options, postingDate: options.postingDate ?? todayIST() };

    return this.transact(auth, async (tx) => {
      const results = await imp.run({ tx, auth, meta, options: opts }, rows);
      const summary = summarise(results);
      const result: SheetResult = { entity, title: imp.title, fileName: file.fileName, committed: false, summary, ignoredColumns, rows: results };
      if (!commit || (summary.errors && !options.skipInvalid) || !summary.created) throw new Rollback(result);
      await this.audit.log(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'import.completed',
        entityType: entity,
        metadata: { fileName: file.fileName, ...summary },
        ...meta,
      });
      return { ...result, committed: true };
    });
  }

  /** Tally masters: units → groups → godowns → items → parties → opening stock, in one transaction. */
  async tally(auth: AuthContext, file: { buffer: Buffer; fileName: string }, options: TallyOptions & { skipInvalid?: boolean }, commit: boolean, meta: RequestMeta): Promise<TallyResult> {
    const data = parseTally(file.buffer);
    if (options.defaultGstRate) for (const r of data.items) if (!r.values.gst_rate && r.values.nil_rated !== 'yes') r.values.gst_rate = options.defaultGstRate;
    const opts: ImportOptions = { ...options, postingDate: options.postingDate ?? todayIST() };

    return this.transact(auth, async (tx) => {
      const ctx: RunContext = { tx, auth, meta, options: opts };
      const sections: TallySection[] = [];
      const add = (key: TallySection['key'], title: string, rows: RowResult[]) => rows.length && sections.push({ key, title, summary: summarise(rows), rows });

      add('units', 'Units', await this.tallyUnits(ctx, data.units));
      const groupRows = await this.tallyGroups(ctx, data.groups);
      add('groups', 'Stock groups', groupRows.results);
      const godowns = await this.tallyGodowns(ctx, data.godowns);
      add('warehouses', 'Godowns → warehouses', godowns.results);

      for (const r of data.items) if (r.values.group && !groupRows.known.has(r.values.group.toLowerCase())) r.values.group = '';
      add('items', 'Stock items', await this.itemsImporter.run(ctx, data.items));
      if (options.includeParties !== false) add('parties', 'Customers & vendors', await this.partiesImporter.run(ctx, data.parties));
      if (options.includeOpeningStock && data.opening.length) {
        for (const r of data.opening) r.values.warehouse = godowns.codeFor(r.values.warehouse);
        add('opening_stock', 'Opening stock', await this.openingImporter.run(ctx, data.opening));
      }

      const all = sections.flatMap((s) => s.rows);
      const summary = summarise(all);
      const result: TallyResult = { fileName: file.fileName, committed: false, summary, sections, warnings: data.warnings, ignored: data.skipped };
      if (!commit || (summary.errors && !options.skipInvalid) || !summary.created) throw new Rollback(result);
      await this.audit.log(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'import.completed',
        entityType: 'tally',
        metadata: { fileName: file.fileName, ...summary, sections: Object.fromEntries(sections.map((s) => [s.key, s.summary])) },
        ...meta,
      });
      return { ...result, committed: true };
    });
  }

  // ---- helpers -----------------------------------------------------------------------

  private async transact<T>(auth: AuthContext, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    try {
      return await this.database.run(auth, fn);
    } catch (e) {
      if (e instanceof Rollback) return e.result as T;
      throw e;
    }
  }

  /** Renames file headers to column keys and drops the template's example row. */
  private mapColumns(imp: Importer, parsed: ParsedSheet): { rows: ImportRow[]; ignoredColumns: string[] } {
    const lookup = new Map<string, string>();
    for (const c of imp.columns) {
      lookup.set(c.key, c.key);
      lookup.set(c.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''), c.key);
      for (const a of c.aliases ?? []) if (!lookup.has(a)) lookup.set(a, c.key);
    }
    const mapped = parsed.headers.map((h) => lookup.get(h) ?? null);
    const ignoredColumns = parsed.headers.filter((h, i) => h && !mapped[i]);
    const missing = imp.columns.filter((c) => c.required && !mapped.includes(c.key));
    if (missing.length) {
      throw new BadRequestException(
        `Missing column${missing.length > 1 ? 's' : ''}: ${missing.map((c) => c.label).join(', ')}. Download the template to see the expected headers.`,
      );
    }
    const examples = imp.columns.filter((c) => c.example);
    const rows = parsed.rows
      .map((r) => {
        const values: Record<string, string> = {};
        parsed.headers.forEach((h, i) => {
          const key = mapped[i];
          if (key && !values[key]) values[key] = r.values[h] ?? '';
        });
        return { rowNo: r.rowNo, values };
      })
      .filter((r) => !(examples.length && examples.every((c) => (r.values[c.key] ?? '') === c.example)));
    if (!rows.length) throw new BadRequestException('Only the example row was found. Add your data below the header and upload again.');
    return { rows, ignoredColumns };
  }

  private async tallyUnits(ctx: RunContext, units: { name: string; code: string; decimals: number; uqc: string }[]): Promise<RowResult[]> {
    const existing = new Set((await ctx.tx.select({ code: uoms.code }).from(uoms)).map((u) => u.code.toUpperCase()));
    const results: RowResult[] = [];
    let rowNo = 0;
    for (const u of units) {
      rowNo++;
      const code = unitKey(u.name).slice(0, 10).replace(/[^A-Z0-9._/-]/g, '') || 'UNIT';
      if (existing.has(code)) {
        results.push({ rowNo, status: 'skipped', label: `${u.name} → ${code}`, message: 'Matches an existing unit', errors: [] });
        continue;
      }
      try {
        const row = await ctx.tx.transaction((sp) => this.setup.saveUomTx(sp, ctx.auth, null, { code, name: u.name.slice(0, 60), decimals: u.decimals, uqc: u.uqc, isActive: true }, ctx.meta));
        existing.add(code);
        results.push({ rowNo, status: 'created', label: `${u.name} → ${code}`, errors: [], ref: { id: row.id, code } });
      } catch (e) {
        results.push({ rowNo, status: 'error', label: u.name, errors: errorsFrom(e, {}) });
      }
    }
    return results;
  }

  private async tallyGroups(ctx: RunContext, groups: { name: string; parent: string | null }[]) {
    const rows = await ctx.tx.select({ id: itemGroups.id, code: itemGroups.code, name: itemGroups.name, parentId: itemGroups.parentId }).from(itemGroups).orderBy(asc(itemGroups.name));
    const byName = new Map(rows.map((g) => [g.name.toLowerCase(), g]));
    const depth = new Map<string, number>();
    const depthOf = (id: string | null): number => {
      if (!id) return 0;
      if (depth.has(id)) return depth.get(id)!;
      const g = rows.find((x) => x.id === id);
      const d = g ? 1 + depthOf(g.parentId) : 0;
      depth.set(id, d);
      return d;
    };
    const taken = new Set(rows.map((g) => g.code.toUpperCase()));
    const results: RowResult[] = [];
    // Parents first, so children can attach to them.
    const pending = [...groups.filter((g) => g.name.toLowerCase() !== 'primary')];
    const ordered: typeof pending = [];
    while (pending.length) {
      const idx = pending.findIndex((g) => !g.parent || g.parent.toLowerCase() === 'primary' || !pending.some((p) => p.name === g.parent));
      ordered.push(...pending.splice(idx < 0 ? 0 : idx, 1));
    }
    let rowNo = 0;
    for (const g of ordered) {
      rowNo++;
      const hit = byName.get(g.name.toLowerCase());
      if (hit) {
        results.push({ rowNo, status: 'skipped', label: g.name, message: `Matches group ${hit.code}`, errors: [] });
        continue;
      }
      const parent = g.parent ? byName.get(g.parent.toLowerCase()) : undefined;
      // Groups nest at most 3 deep here; deeper Tally groups attach to the deepest allowed level.
      let parentId = parent?.id ?? null;
      while (parentId && depthOf(parentId) >= 3) parentId = rows.find((x) => x.id === parentId)?.parentId ?? null;
      const code = uniqueCode(g.name, 20, taken);
      try {
        const saved = await ctx.tx.transaction((sp) => this.setup.saveGroupTx(sp, ctx.auth, null, { code, name: g.name.slice(0, 80), parentId, isActive: true }, ctx.meta));
        const row = { id: saved.id, code, name: g.name, parentId };
        rows.push(row);
        byName.set(g.name.toLowerCase(), row);
        results.push({ rowNo, status: 'created', label: `${code} · ${g.name}`, errors: [], ref: { id: saved.id, code } });
      } catch (e) {
        results.push({ rowNo, status: 'error', label: g.name, errors: errorsFrom(e, {}) });
      }
    }
    return { results, known: new Set(byName.keys()) };
  }

  private async tallyGodowns(ctx: RunContext, godowns: string[]) {
    const rows = await ctx.tx.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name }).from(warehouses);
    const byName = new Map(rows.map((w) => [w.name.toLowerCase(), w.code]));
    const main = rows.find((w) => w.code.toUpperCase() === 'MAIN')?.code ?? rows[0]?.code ?? 'MAIN';
    const taken = new Set(rows.map((w) => w.code.toUpperCase()));
    const results: RowResult[] = [];
    const codes = new Map<string, string>();
    let rowNo = 0;
    for (const name of godowns) {
      rowNo++;
      const lower = name.toLowerCase();
      if (lower === 'main location' || lower === 'primary') {
        codes.set(lower, main);
        results.push({ rowNo, status: 'skipped', label: name, message: `Uses warehouse ${main}`, errors: [] });
        continue;
      }
      const existing = byName.get(lower);
      if (existing) {
        codes.set(lower, existing);
        results.push({ rowNo, status: 'skipped', label: name, message: `Matches warehouse ${existing}`, errors: [] });
        continue;
      }
      const code = uniqueCode(name, 20, taken);
      try {
        const saved = await ctx.tx.transaction((sp) =>
          this.setup.saveWarehouseTx(sp, ctx.auth, null, { code, name: name.slice(0, 80), type: 'store', address: {}, allowNegativeStock: false, isActive: true }, ctx.meta),
        );
        codes.set(lower, code);
        results.push({ rowNo, status: 'created', label: `${code} · ${name}`, errors: [], ref: { id: saved.id, code } });
      } catch (e) {
        results.push({ rowNo, status: 'error', label: name, errors: errorsFrom(e, {}) });
      }
    }
    return { results, codeFor: (godown: string) => (godown ? (codes.get(godown.toLowerCase()) ?? godown) : main) };
  }
}

