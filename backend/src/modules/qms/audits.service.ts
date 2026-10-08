import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { auditFindings, internalAudits } from '@nextgen/database';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { CapasService } from '../quality/capas.service';
import { many } from '../../common/sql';

export const auditSchema = z.object({
  title: z.string().trim().min(3).max(200),
  standard: z.string().trim().min(2).max(60),
  area: z.string().trim().min(2).max(120),
  plannedDate: z.iso.date(),
  auditor: z.string().trim().min(2).max(120),
  auditee: optionalText(120),
});
export const auditDoneSchema = z.object({ summary: z.string().trim().min(3).max(4000), doneOn: z.iso.date().optional() });
export const findingSchema = z.object({ kind: z.enum(['major_nc', 'minor_nc', 'observation', 'ofi']), clause: optionalText(40), description: z.string().trim().min(3).max(2000) });

/** Internal audits: plan, record as done with a summary, findings (major / minor NC, observation, OFI), CAPA for nonconformities. */
@Injectable()
export class AuditsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly capas: CapasService,
  ) {}

  list(auth: AuthContext, q: { year?: string }) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select a.id, a.title, a.standard, a.area, a.planned_date::text as "plannedDate", a.auditor, a.auditee, a.status, a.done_on::text as "doneOn",
                   (a.status = 'planned' and a.planned_date < (now() at time zone 'Asia/Kolkata')::date) as overdue,
                   (select count(*)::int from audit_findings f where f.audit_id = a.id and f.kind in ('major_nc', 'minor_nc')) as ncs,
                   (select count(*)::int from audit_findings f where f.audit_id = a.id and f.closed_on is null) as "openFindings"
            from internal_audits a ${q.year ? sql`where extract(year from a.planned_date) = ${Number(q.year)}` : sql``}
            order by a.planned_date`,
      ),
    );
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [a] = await tx.select().from(internalAudits).where(eq(internalAudits.id, id));
      if (!a) throw new NotFoundException('Audit not found');
      const findings = await many(
        tx,
        sql`select f.id, f.kind, f.clause, f.description, f.capa_id as "capaId", d.number as "capaNumber", c.stage as "capaStage", f.closed_on::text as "closedOn"
            from audit_findings f left join capas c on c.id = f.capa_id left join documents d on d.id = f.capa_id
            where f.audit_id = ${id} order by f.id`,
      );
      const { tenantId: _t, ...rest } = a;
      return { ...rest, findings };
    });
  }

  create(auth: AuthContext, input: z.infer<typeof auditSchema>) {
    return this.database.run(auth, async (tx) => (await tx.insert(internalAudits).values({ tenantId: auth.tenantId, ...input }).returning())[0]);
  }

  update(auth: AuthContext, id: string, input: z.infer<typeof auditSchema>) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.update(internalAudits).set(input).where(eq(internalAudits.id, id)).returning();
      if (!r) throw new NotFoundException('Audit not found');
      return r;
    });
  }

  done(auth: AuthContext, id: string, input: z.infer<typeof auditDoneSchema>) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.update(internalAudits).set({ status: 'done', doneOn: input.doneOn ?? todayIST(), summary: input.summary }).where(and(eq(internalAudits.id, id), eq(internalAudits.status, 'planned'))).returning();
      if (!r) throw new ConflictException('Audit not found or already done');
      return r;
    });
  }

  addFinding(auth: AuthContext, id: string, input: z.infer<typeof findingSchema>) {
    return this.database.run(auth, async (tx) => {
      const [a] = await tx.select({ id: internalAudits.id }).from(internalAudits).where(eq(internalAudits.id, id));
      if (!a) throw new NotFoundException('Audit not found');
      const [f] = await tx.insert(auditFindings).values({ tenantId: auth.tenantId, auditId: id, ...input }).returning();
      return f;
    });
  }

  /** A draft CAPA for a finding (nonconformities must have one before they can be closed). */
  findingCapa(auth: AuthContext, findingId: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [f] = await tx.select({ f: auditFindings, title: internalAudits.title, standard: internalAudits.standard }).from(auditFindings).innerJoin(internalAudits, eq(internalAudits.id, auditFindings.auditId)).where(eq(auditFindings.id, findingId));
      if (!f) throw new NotFoundException('Finding not found');
      if (f.f.capaId) throw new ConflictException('A CAPA is already linked');
      const capa = await this.capas.createTx(tx, auth, { kind: 'corrective', source: 'audit', ncrId: null, complaintId: null, itemId: null, isScar: false, partyId: null, responseDue: null, problem: `${f.title} (${f.standard}${f.f.clause ? ` ${f.f.clause}` : ''}): ${f.f.description}`.slice(0, 4000), method: '5why', whys: [], fishbone: {}, eightD: {}, rootCause: null, effectivenessDue: null, actions: [] }, meta);
      await tx.update(auditFindings).set({ capaId: capa.id }).where(eq(auditFindings.id, findingId));
      return capa;
    });
  }

  /** Closes a finding; a nonconformity needs its CAPA closed first. */
  closeFinding(auth: AuthContext, findingId: string) {
    return this.database.run(auth, async (tx) => {
      const [f] = await many<{ kind: string; closed_on: string | null; capa_stage: string | null }>(tx, sql`select f.kind, f.closed_on::text, c.stage as capa_stage from audit_findings f left join capas c on c.id = f.capa_id where f.id = ${findingId}`);
      if (!f) throw new NotFoundException('Finding not found');
      if (f.closed_on) throw new ConflictException('Already closed');
      if ((f.kind === 'major_nc' || f.kind === 'minor_nc') && f.capa_stage !== 'closed') throw new ConflictException('Close the nonconformity’s CAPA first');
      await tx.update(auditFindings).set({ closedOn: todayIST() }).where(eq(auditFindings.id, findingId));
      return { ok: true };
    });
  }

  /** Findings by standard and clause, for management review. */
  summary(auth: AuthContext, year: number) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select a.standard, f.kind, count(*)::int as count, count(*) filter (where f.closed_on is null)::int as open
            from audit_findings f join internal_audits a on a.id = f.audit_id
            where extract(year from a.planned_date) = ${year} group by 1, 2 order by 1, 2`,
      ),
    );
  }
}

