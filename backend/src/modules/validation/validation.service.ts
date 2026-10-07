import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { valApprovals, valProjects, valTests, type Transaction } from '@nextgen/database';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import type { RequestMeta } from '../../common/request-meta';
import type { Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { ESignService } from '../gmp/esign.service';
import { MODULES, REQUIREMENTS, requirementsFor } from './catalogue';
import { defaultRisk, riskPriority, summarise, TESTING, traceability, type Priority } from './risk';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const rating = z.number().int().min(1).max(3);

export const projectSchema = z.object({
  name: z.string().trim().min(3).max(120),
  modules: z.array(z.enum(Object.keys(MODULES) as [string, ...string[]])).min(1),
  gampCategory: z.union([z.literal(4), z.literal(5)]).default(4),
  intendedUse: z.string().trim().max(2000).nullable().optional(),
});
export const riskSchema = z.object({ requirementId: z.string().min(1).max(40), severity: rating, probability: rating, detectability: rating, note: z.string().trim().max(500).nullable().optional() });
export const testSchema = z.object({ protocol: z.enum(['OQ', 'PQ']), title: z.string().trim().min(3).max(200), requirementIds: z.array(z.string().min(1).max(40)).min(1).max(20), steps: z.array(z.string().trim().min(1).max(500)).min(1).max(40), expected: z.string().trim().min(3).max(1000) });
export const executeSchema = z.object({ result: z.enum(['pass', 'fail', 'na']), actual: z.string().trim().min(2).max(2000), evidence: z.string().trim().max(1000).nullable().optional(), deviationId: z.uuid().nullable().optional() });
export const signSchema = z.object({ document: z.enum(['URS', 'RA', 'IQ', 'OQ', 'PQ', 'VSR']), role: z.enum(['author', 'reviewer', 'approver']), reason: z.string().trim().max(500).nullable().optional(), password: z.string().min(1).max(200) });

const DOCS: Record<string, string> = { URS: 'User requirements and functional specification', RA: 'Risk assessment', IQ: 'Installation qualification', OQ: 'Operational qualification', PQ: 'Performance qualification', VSR: 'Validation summary report' };

/** IQ checks the system runs on itself. */
const IQ_CHECKS = [
  { ref: 'IQ-01', title: 'Database server version recorded', expected: 'PostgreSQL 16 or later', automated: 'db_version' },
  { ref: 'IQ-02', title: 'Application release recorded', expected: 'The release under validation is installed', automated: 'app_version' },
  { ref: 'IQ-03', title: 'Row-level security on every workspace table', expected: 'No table with workspace data lacks row-level security', automated: 'rls' },
  { ref: 'IQ-04', title: 'Audit trail cannot be changed or deleted', expected: 'The application role has no update or delete right on the audit trail', automated: 'audit_append_only' },
  { ref: 'IQ-05', title: 'Electronic signatures cannot be changed or deleted', expected: 'The application role has no update or delete right on signatures', automated: 'esign_append_only' },
  { ref: 'IQ-06', title: 'Signature chain intact', expected: 'Every chained signature matches its content and the chain', automated: 'esign_chain' },
  { ref: 'IQ-07', title: 'Application and database clocks agree', expected: 'Difference under 5 seconds', automated: 'clock' },
  { ref: 'IQ-08', title: 'Production security settings', expected: 'Token secrets of at least 32 characters; production mode', automated: 'config' },
  { ref: 'IQ-09', title: 'Backups configured and a restore tested', expected: 'Daily database backups exist and a restore to a test server succeeded', automated: null },
];

/**
 * Computer system validation package (GAMP 5): scope by module, user requirements with the
 * functional specification, risk assessment with testing depth, IQ (checks the system runs on
 * itself), OQ from the requirement catalogue, PQ written by the site, execution with evidence,
 * the traceability matrix, signed approvals and the summary report.
 */
@Injectable()
export class ValidationService {
  private readonly version: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly esign: ESignService,
    private readonly config: ConfigService<Env, true>,
  ) {
    let v = '0.0.0';
    try {
      v = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version;
    } catch {
      /* keep the default */
    }
    this.version = v;
  }

  catalogue() {
    return { modules: MODULES, requirements: REQUIREMENTS };
  }

  projects(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select p.id, p.name, p.system_version as "systemVersion", p.modules, p.status, p.created_at as "createdAt",
              (select count(*)::int from val_tests t where t.project_id = p.id) as tests,
              (select count(*)::int from val_tests t where t.project_id = p.id and t.result = 'pass') as passed,
              (select count(*)::int from val_tests t where t.project_id = p.id and t.result = 'fail') as failed
            from val_projects p order by p.created_at desc`,
      ),
    );
  }

  create(auth: AuthContext, input: z.infer<typeof projectSchema>) {
    return this.database.run(auth, async (tx) => {
      const reqs = requirementsFor(input.modules);
      const risks = Object.fromEntries(reqs.map((r) => [r.id, defaultRisk(r)]));
      const [p] = await tx.insert(valProjects).values({ tenantId: auth.tenantId, name: input.name, systemVersion: this.version, modules: input.modules, gampCategory: input.gampCategory, intendedUse: input.intendedUse ?? null, risks, createdBy: auth.userId }).returning();
      const tests = [
        ...IQ_CHECKS.map((c) => ({ protocol: 'IQ', ref: c.ref, title: c.title, requirementIds: ['URS-PLT-03', 'URS-PLT-04', 'URS-PLT-05'].filter((id) => (c.automated === 'rls' && id === 'URS-PLT-03') || (c.automated === 'audit_append_only' && id === 'URS-PLT-04') || (['esign_append_only', 'esign_chain'].includes(c.automated ?? '') && id === 'URS-PLT-05')), steps: c.automated ? ['Run the installation checks'] : ['Check the backup schedule', 'Restore the latest backup to a test server', 'Sign in and open a recent record'], expected: c.expected, automated: c.automated })),
        ...reqs.flatMap((r) => r.tests.map((t, i) => ({ protocol: 'OQ', ref: `OQ-${r.id.replace('URS-', '')}${r.tests.length > 1 ? `-${i + 1}` : ''}`, title: t.title, requirementIds: [r.id], steps: t.steps, expected: t.expected, automated: null, evidence: t.automatedBy ? `Also covered by the automated test ${t.automatedBy}` : null }))),
      ];
      await tx.insert(valTests).values(tests.map((t) => ({ tenantId: auth.tenantId, projectId: p.id, ...t })));
      return p;
    });
  }

  private async project(tx: Transaction, id: string) {
    const [p] = await tx.select().from(valProjects).where(eq(valProjects.id, id));
    if (!p) throw new NotFoundException('Validation project not found');
    return p;
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => this.view(tx, id));
  }

  private async view(tx: Transaction, id: string) {
    const p = await this.project(tx, id);
    const reqs = requirementsFor(p.modules);
    const priorities: Record<string, Priority> = {};
    const requirements = reqs.map((r) => {
      const k = p.risks[r.id] ?? defaultRisk(r);
      const priority = riskPriority(k.severity, k.probability, k.detectability);
      priorities[r.id] = priority;
      return { ...r, risk: k, priority, testing: TESTING[priority] };
    });
    const tests = await tx.select().from(valTests).where(eq(valTests.projectId, id)).orderBy(asc(valTests.protocol), asc(valTests.ref));
    const approvals = await many<{ document: string; role: string; signedBy: string; signedAt: string; meaning: string; reason: string | null }>(
      tx,
      sql`select a.document, a.role, s.signer_name as "signedBy", s.signed_at as "signedAt", s.meaning, s.reason from val_approvals a join e_signatures s on s.id = a.signature_id where a.project_id = ${id} order by s.signed_at`,
    );
    const trace = traceability(reqs, priorities, tests);
    return {
      ...p,
      requirements,
      tests,
      approvals,
      trace,
      summary: summarise(trace, tests),
      documents: DOCS,
    };
  }

  setRisk(auth: AuthContext, id: string, input: z.infer<typeof riskSchema>) {
    return this.database.run(auth, async (tx) => {
      const p = await this.project(tx, id);
      if (p.status === 'approved') throw new ConflictException('The validation is approved; start a new one for changes');
      if (!requirementsFor(p.modules).some((r) => r.id === input.requirementId)) throw new BadRequestException('Not a requirement in scope');
      await tx
        .update(valProjects)
        .set({ risks: { ...p.risks, [input.requirementId]: { severity: input.severity, probability: input.probability, detectability: input.detectability, note: input.note ?? null } } })
        .where(eq(valProjects.id, id));
      return this.view(tx, id);
    });
  }

  addTest(auth: AuthContext, id: string, input: z.infer<typeof testSchema>) {
    return this.database.run(auth, async (tx) => {
      const p = await this.project(tx, id);
      if (p.status === 'approved') throw new ConflictException('The validation is approved');
      const ids = requirementsFor(p.modules).map((r) => r.id);
      const unknown = input.requirementIds.filter((r) => !ids.includes(r));
      if (unknown.length) throw new BadRequestException(`Not in scope: ${unknown.join(', ')}`);
      const [n] = await many<{ n: number }>(tx, sql`select count(*)::int as n from val_tests where project_id = ${id} and protocol = ${input.protocol}`);
      const [t] = await tx.insert(valTests).values({ tenantId: auth.tenantId, projectId: id, protocol: input.protocol, ref: `${input.protocol}-S${String(n.n + 1).padStart(2, '0')}`, title: input.title, requirementIds: input.requirementIds, steps: input.steps, expected: input.expected }).returning();
      return t;
    });
  }

  execute(auth: AuthContext, id: string, testId: string, input: z.infer<typeof executeSchema>) {
    return this.database.run(auth, async (tx) => {
      const p = await this.project(tx, id);
      if (p.status === 'approved') throw new ConflictException('The validation is approved');
      const [t] = await tx.select().from(valTests).where(and(eq(valTests.id, testId), eq(valTests.projectId, id)));
      if (!t) throw new NotFoundException('Test not found');
      await this.requireApproved(tx, id, t.protocol);
      if (input.result === 'fail' && !input.deviationId) throw new BadRequestException('A failed test needs a deviation');
      await tx.update(valTests).set({ result: input.result, actual: input.actual, evidence: input.evidence ?? t.evidence, deviationId: input.deviationId ?? null, executedBy: auth.userId, executedAt: new Date() }).where(eq(valTests.id, testId));
      if (p.status === 'draft') await tx.update(valProjects).set({ status: 'executing' }).where(eq(valProjects.id, id));
      return this.view(tx, id);
    });
  }

  /** A protocol is executed only after it has been approved. */
  private async requireApproved(tx: Transaction, projectId: string, document: string) {
    const [a] = await tx.select({ id: valApprovals.id }).from(valApprovals).where(and(eq(valApprovals.projectId, projectId), eq(valApprovals.document, document), eq(valApprovals.role, 'approver')));
    if (!a) throw new ConflictException(`Approve the ${DOCS[document]} protocol before executing it`);
  }

  /** Runs the installation checks the system can make on itself and records the results. */
  runIq(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      await this.project(tx, id);
      await this.requireApproved(tx, id, 'IQ');
      const results: Record<string, { pass: boolean; actual: string }> = {};
      const [v] = await many<{ v: string; n: number; now: string }>(tx, sql`select version() as v, current_setting('server_version_num')::int as n, now()::text as now`);
      results.db_version = { pass: v.n >= 160000, actual: v.v.split(',')[0] };
      results.app_version = { pass: true, actual: `NextGen ERP ${this.version} on Node.js ${process.version}` };
      const noRls = await many<{ t: string }>(
        tx,
        sql`select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity and exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'tenant_id')`,
      );
      results.rls = { pass: noRls.length === 0, actual: noRls.length ? `Without row-level security: ${noRls.map((r) => r.t).join(', ')}` : 'Every table with a workspace id has row-level security enabled' };
      const [priv] = await many<{ au: boolean; ad: boolean; su: boolean; sd: boolean }>(
        tx,
        sql`select has_table_privilege('audit_logs', 'UPDATE') as au, has_table_privilege('audit_logs', 'DELETE') as ad, has_table_privilege('e_signatures', 'UPDATE') as su, has_table_privilege('e_signatures', 'DELETE') as sd`,
      );
      results.audit_append_only = { pass: !priv.au && !priv.ad, actual: `Update ${priv.au ? 'allowed' : 'denied'}, delete ${priv.ad ? 'allowed' : 'denied'}` };
      results.esign_append_only = { pass: !priv.su && !priv.sd, actual: `Update ${priv.su ? 'allowed' : 'denied'}, delete ${priv.sd ? 'allowed' : 'denied'}` };
      const skew = Math.abs(Date.parse(v.now) - Date.now()) / 1000;
      results.clock = { pass: skew < 5, actual: `Difference ${skew.toFixed(1)} s` };
      const accessLen = this.config.get('JWT_ACCESS_SECRET', { infer: true }).length;
      const refreshLen = this.config.get('JWT_REFRESH_SECRET', { infer: true }).length;
      const env = this.config.get('NODE_ENV', { infer: true });
      results.config = { pass: accessLen >= 32 && refreshLen >= 32 && env === 'production', actual: `Secrets ${accessLen >= 32 && refreshLen >= 32 ? 'meet' : 'do not meet'} the length rule; mode ${env}` };
      const chain = await this.esign.verify(auth);
      results.esign_chain = { pass: chain.intact, actual: `${chain.checked} of ${chain.total} signatures checked; ${chain.broken.length} broken` };
      const tests = await tx.select().from(valTests).where(and(eq(valTests.projectId, id), eq(valTests.protocol, 'IQ')));
      for (const t of tests.filter((x) => x.automated && results[x.automated])) {
        const r = results[t.automated!];
        await tx.update(valTests).set({ result: r.pass ? 'pass' : 'fail', actual: r.actual, evidence: `Checked by the system on ${new Date().toISOString()}`, executedBy: auth.userId, executedAt: new Date() }).where(eq(valTests.id, t.id));
      }
      await tx.update(valProjects).set({ status: 'executing' }).where(and(eq(valProjects.id, id), eq(valProjects.status, 'draft')));
      return this.view(tx, id);
    });
  }

  /** Signs a document; the summary report can be approved only when everything is covered. */
  sign(auth: AuthContext, id: string, input: z.infer<typeof signSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const view = await this.view(tx, id);
      if (view.status === 'approved') throw new ConflictException('The validation is already approved');
      if (input.document === 'VSR' && input.role === 'approver' && !view.summary.fitForUse) throw new ConflictException('The system is not shown fit for use yet: every requirement needs passing tests');
      const prior = view.approvals.filter((a) => a.document === input.document);
      if (input.role !== 'author' && prior.some((a) => a.role === input.role)) throw new ConflictException(`The ${DOCS[input.document]} already has a ${input.role} signature`);
      const payload = input.document === 'VSR' ? { summary: view.summary, trace: view.trace } : input.document === 'RA' ? { risks: view.requirements.map((r) => ({ id: r.id, risk: r.risk, priority: r.priority })) } : input.document === 'URS' ? { requirements: view.requirements.map((r) => r.id) } : { tests: view.tests.filter((t) => t.protocol === input.document).map((t) => ({ ref: t.ref, steps: t.steps, expected: t.expected, result: t.result })) };
      const sig = await this.esign.sign(tx, auth, { entityType: 'validation', entityId: id, meaning: `${DOCS[input.document]}: ${input.role}`, reason: input.reason ?? null, payload: { document: input.document, role: input.role, ...payload }, password: input.password, ip: meta.ip });
      await tx.insert(valApprovals).values({ tenantId: auth.tenantId, projectId: id, document: input.document, role: input.role, signatureId: sig.id });
      if (input.document === 'VSR' && input.role === 'approver') await tx.update(valProjects).set({ status: 'approved' }).where(eq(valProjects.id, id));
      return this.view(tx, id);
    });
  }
}
