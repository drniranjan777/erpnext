import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  branches,
  companies,
  DOC_TYPES,
  isDocType,
  numberSeries,
  numberSeriesCounters,
  type DocType,
  type Transaction,
} from '@nextgen/database';
import { and, asc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { fiscalYearOf, todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { gstNumberProblems, periodKey, renderPattern, validatePattern } from './numbering';
import type { CreateSeriesInput, PreviewSeriesInput, UpdateSeriesInput } from './documents.schemas';

type SeriesRow = typeof numberSeries.$inferSelect;

export interface Allocation {
  seriesId: string;
  number: string;
  fiscalYear: string;
}

@Injectable()
export class NumberingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ---- Allocation (called inside a document transaction) ---------------------

  /**
   * Allocates the next number. The counter row is locked by the upsert until the
   * caller's transaction ends, so numbers are gapless and never duplicated.
   */
  async allocate(
    tx: Transaction,
    auth: AuthContext,
    doc: { docType: DocType; companyId: string; branchId: string | null; docDate: string },
  ): Promise<Allocation> {
    const series = await this.resolveSeries(tx, auth, doc);
    const [company] = await tx.select({ fyStartMonth: companies.fyStartMonth }).from(companies).where(eq(companies.id, doc.companyId));
    const fyStart = company?.fyStartMonth ?? 4;
    const key = periodKey(series.reset, doc.docDate, fyStart);

    const res = await tx.execute<{ value: string }>(sql`
      insert into number_series_counters (tenant_id, series_id, period_key, next_value)
      values (${auth.tenantId}, ${series.id}, ${key}, ${series.startAt + 1})
      on conflict (series_id, period_key)
      do update set next_value = number_series_counters.next_value + 1, updated_at = now()
      returning next_value - 1 as value`);
    const seq = Number(res.rows[0].value);

    const branchCode = await this.branchCode(tx, doc.branchId);
    const number = renderPattern(series.pattern, { docDate: doc.docDate, fyStartMonth: fyStart, branchCode, seq, padding: series.padding });
    return { seriesId: series.id, number, fiscalYear: fiscalYearOf(doc.docDate, fyStart).label4 };
  }

  /** Branch-specific default → company-wide default → any active → auto-created default. */
  private async resolveSeries(
    tx: Transaction,
    auth: AuthContext,
    doc: { docType: DocType; companyId: string; branchId: string | null },
  ): Promise<SeriesRow> {
    const candidates = await tx
      .select()
      .from(numberSeries)
      .where(
        and(
          eq(numberSeries.companyId, doc.companyId),
          eq(numberSeries.docType, doc.docType),
          eq(numberSeries.isActive, true),
          doc.branchId ? or(eq(numberSeries.branchId, doc.branchId), isNull(numberSeries.branchId)) : isNull(numberSeries.branchId),
        ),
      );
    const rank = (s: SeriesRow) => (s.branchId ? 0 : 2) + (s.isDefault ? 0 : 1);
    const best = candidates.sort((a, b) => rank(a) - rank(b))[0];
    if (best) return best;

    // Zero-config: first document of this type creates the default series.
    const [created] = await tx
      .insert(numberSeries)
      .values({
        tenantId: auth.tenantId,
        companyId: doc.companyId,
        docType: doc.docType,
        name: 'Default',
        pattern: DOC_TYPES[doc.docType].defaultPattern,
        isDefault: true,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    const [existing] = await tx
      .select()
      .from(numberSeries)
      .where(and(eq(numberSeries.companyId, doc.companyId), eq(numberSeries.docType, doc.docType), eq(numberSeries.name, 'Default')));
    return existing;
  }

  private async branchCode(tx: Transaction, branchId: string | null) {
    if (!branchId) return null;
    const [b] = await tx.select({ code: branches.code }).from(branches).where(eq(branches.id, branchId));
    return b?.code.toUpperCase() ?? null;
  }

  // ---- Admin ------------------------------------------------------------------

  list(auth: AuthContext, docType?: string) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .select({
          series: numberSeries,
          companyName: companies.name,
          fyStartMonth: companies.fyStartMonth,
          branchCode: branches.code,
          branchName: branches.name,
        })
        .from(numberSeries)
        .innerJoin(companies, eq(companies.id, numberSeries.companyId))
        .leftJoin(branches, eq(branches.id, numberSeries.branchId))
        .where(docType ? eq(numberSeries.docType, docType) : undefined)
        .orderBy(asc(numberSeries.docType), asc(companies.name), asc(numberSeries.name));

      const counters = await tx.select().from(numberSeriesCounters);
      const today = todayIST();
      return rows.map(({ series, companyName, fyStartMonth, branchCode, branchName }) => {
        const key = periodKey(series.reset, today, fyStartMonth);
        const counter = counters.find((c) => c.seriesId === series.id && c.periodKey === key);
        const nextSeq = counter?.nextValue ?? series.startAt;
        return {
          ...series,
          docTypeLabel: isDocType(series.docType) ? DOC_TYPES[series.docType].label : series.docType,
          companyName,
          branch: series.branchId ? { id: series.branchId, code: branchCode, name: branchName } : null,
          nextNumber: renderPattern(series.pattern, {
            docDate: today,
            fyStartMonth,
            branchCode: branchCode?.toUpperCase() ?? 'HO',
            seq: nextSeq,
            padding: series.padding,
          }),
        };
      });
    });
  }

  preview(input: PreviewSeriesInput) {
    const errors = validatePattern(input.pattern);
    const sample = renderPattern(input.pattern, {
      docDate: input.docDate ?? todayIST(),
      fyStartMonth: 4,
      branchCode: input.branchCode ?? 'HO',
      seq: input.startAt ?? 1,
      padding: input.padding ?? 4,
    });
    const gst = isDocType(input.docType) && DOC_TYPES[input.docType].gstDocument ? gstNumberProblems(sample) : [];
    return { sample, errors, warnings: gst };
  }

  async create(auth: AuthContext, input: CreateSeriesInput, meta: RequestMeta) {
    this.assertValid(input.docType, input.pattern, input.padding);
    return this.database.run(auth, async (tx) => {
      await this.assertNameFree(tx, input.companyId, input.docType, input.name);
      if (input.isDefault) await this.clearDefault(tx, input.companyId, input.docType, input.branchId ?? null);
      const [row] = await tx
        .insert(numberSeries)
        .values({ ...input, branchId: input.branchId ?? null, tenantId: auth.tenantId, createdBy: auth.userId, updatedBy: auth.userId })
        .returning();
      await this.audit.log(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'platform.number_series.created',
        entityType: 'number_series',
        entityId: row.id,
        changes: this.audit.diff({}, { name: row.name, pattern: row.pattern, docType: row.docType }),
        ...meta,
      });
      return row;
    });
  }

  async update(auth: AuthContext, id: string, input: UpdateSeriesInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [before] = await tx.select().from(numberSeries).where(eq(numberSeries.id, id));
      if (!before) throw new NotFoundException('Number series not found');
      if (input.version !== before.version) throw new ConflictException('This series was changed by someone else. Reload and try again.');
      const pattern = input.pattern ?? before.pattern;
      this.assertValid(before.docType, pattern, input.padding ?? before.padding);
      if (input.name && input.name !== before.name) await this.assertNameFree(tx, before.companyId, before.docType, input.name, id);
      if (input.isDefault) await this.clearDefault(tx, before.companyId, before.docType, before.branchId, id);

      const { version: _v, ...patch } = input;
      const [row] = await tx
        .update(numberSeries)
        .set({ ...patch, updatedBy: auth.userId, version: before.version + 1 })
        .where(and(eq(numberSeries.id, id), eq(numberSeries.version, before.version)))
        .returning();
      const changes = this.audit.diff(before as unknown as Record<string, unknown>, patch);
      if (Object.keys(changes).length) {
        await this.audit.log(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'platform.number_series.updated',
          entityType: 'number_series',
          entityId: id,
          changes,
          ...meta,
        });
      }
      return row;
    });
  }

  private assertValid(docType: string, pattern: string, padding: number) {
    if (!isDocType(docType)) throw new BadRequestException('Unknown document type');
    const errors = validatePattern(pattern);
    if (DOC_TYPES[docType].gstDocument) {
      const sample = renderPattern(pattern, { docDate: todayIST(), fyStartMonth: 4, branchCode: 'HO', seq: 1, padding });
      errors.push(...gstNumberProblems(sample));
    }
    if (errors.length) {
      throw new BadRequestException({ message: 'Invalid pattern', errors: errors.map((message) => ({ path: 'pattern', message })) });
    }
  }

  private async assertNameFree(tx: Transaction, companyId: string, docType: string, name: string, exceptId?: string) {
    const [clash] = await tx
      .select({ id: numberSeries.id })
      .from(numberSeries)
      .where(
        and(
          eq(numberSeries.companyId, companyId),
          eq(numberSeries.docType, docType),
          sql`lower(${numberSeries.name}) = lower(${name})`,
          exceptId ? ne(numberSeries.id, exceptId) : undefined,
        ),
      );
    if (clash) throw new ConflictException(`A series named "${name}" already exists for this document type`);
  }

  /** Only one default per company + doc type + branch scope. */
  private async clearDefault(tx: Transaction, companyId: string, docType: string, branchId: string | null, exceptId?: string) {
    await tx
      .update(numberSeries)
      .set({ isDefault: false })
      .where(
        and(
          eq(numberSeries.companyId, companyId),
          eq(numberSeries.docType, docType),
          branchId ? eq(numberSeries.branchId, branchId) : isNull(numberSeries.branchId),
          exceptId ? ne(numberSeries.id, exceptId) : undefined,
        ),
      );
  }
}
