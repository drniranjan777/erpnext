import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { provisionTenant, tenantBranding, type Transaction } from '@nextgen/database';
import { eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import type { Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { colourProblem, domainProblem, emailDomain, logoProblem, senderIdProblem, txtMatches, txtRecord } from './branding-rules';
import { many } from '../../common/sql';

const text = (n: number) => z.string().trim().max(n).nullable().optional();

export const brandingSchema = z.object({
  productName: text(60),
  logo: z.string().max(300_000).nullable().optional(),
  primaryColor: text(7),
  accentColor: text(7),
  supportEmail: z.email().nullable().optional(),
  emailFromName: text(80),
  emailFromAddress: z.email().nullable().optional(),
  smsSenderId: text(6),
  smsEntityId: z.string().trim().regex(/^\d{19}$/, 'The DLT principal entity id has 19 digits').nullable().optional(),
  customDomain: text(253),
});
export const partnerCodeSchema = z.object({ code: z.string().trim().min(2).max(30).nullable() });
export const partnerSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9-]{2,30}$/, 'Codes are capital letters, digits and dashes'),
  name: z.string().trim().min(2).max(160),
  kind: z.enum(['reseller', 'implementer', 'both']),
  email: z.email(),
  gstin: z.string().trim().length(15).nullable().optional(),
  commissionPct: z.number().min(0).max(50),
  certified: z.boolean().default(false),
  status: z.enum(['active', 'suspended']).default('active'),
});
export const memberSchema = z.object({ email: z.email(), role: z.enum(['admin', 'member']).default('member') });
export const payoutSchema = z.object({ reference: z.string().trim().min(2).max(60) });
export const clientSchema = z.object({
  partnerId: z.uuid(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/, 'Lowercase letters, digits and dashes'),
  workspaceName: z.string().trim().min(2).max(120),
  companyName: z.string().trim().min(2).max(160),
  gstin: z.string().trim().length(15).nullable().optional(),
  industry: text(60),
});

/** Looks up TXT records; replaceable in tests. */
class DnsTxt {
  async lookup(host: string): Promise<string[][]> {
    const r = new Resolver({ timeout: 3000, tries: 1 });
    try {
      return await r.resolveTxt(host);
    } catch {
      return [];
    }
  }
}

/**
 * White-label and partners. Branding: product name, logo and colours (contrast-checked), support
 * address, email sender identity and custom domain both proven by DNS TXT records, and the SMS DLT
 * sender. Partners (resellers and implementers) are platform-wide: partner users see their client
 * workspaces and commissions, and create client workspaces they own; the workspace owner can name
 * the partner; platform administrators keep partners, members, commissions and payouts.
 */
@Injectable()
export class WhiteLabelService {
  private readonly ownDomains: string[];
  dns = new DnsTxt();

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService<Env, true>,
  ) {
    this.ownDomains = [new URL(config.get('APP_URL', { infer: true })).hostname, 'nextgen-erp.in', 'localhost'];
  }

  // ---- branding ----------------------------------------------------------------------------------

  private async row(tx: Transaction, tenantId: string) {
    const [b] = await tx.select().from(tenantBranding);
    if (b) return b;
    const [n] = await tx
      .insert(tenantBranding)
      .values({ tenantId, domainToken: randomBytes(16).toString('hex'), emailDomainToken: randomBytes(16).toString('hex') })
      .onConflictDoNothing()
      .returning();
    return n ?? (await tx.select().from(tenantBranding))[0];
  }

  private view(b: typeof tenantBranding.$inferSelect) {
    const dom = b.emailFromAddress ? emailDomain(b.emailFromAddress) : null;
    return {
      ...b,
      dns: {
        domain: b.customDomain ? { host: `_nextgen-verify.${b.customDomain}`, type: 'TXT', value: txtRecord(b.domainToken!), cname: { host: b.customDomain, value: 'cname.nextgen-erp.in' } } : null,
        email: dom ? { host: `_nextgen-verify.${dom}`, type: 'TXT', value: txtRecord(b.emailDomainToken!) } : null,
      },
      emailSenderActive: !!(b.emailFromAddress && b.emailDomainVerifiedAt),
    };
  }

  get(auth: AuthContext) {
    return this.database.run(auth, async (tx) => this.view(await this.row(tx, auth.tenantId)));
  }

  save(auth: AuthContext, input: z.infer<typeof brandingSchema>) {
    const problems = [colourProblem(input.primaryColor), colourProblem(input.accentColor), logoProblem(input.logo), domainProblem(input.customDomain, this.ownDomains), senderIdProblem(input.smsSenderId)].filter(Boolean);
    if (problems.length) throw new BadRequestException(problems.join('; '));
    return this.database.run(auth, async (tx) => {
      const b = await this.row(tx, auth.tenantId);
      const domain = input.customDomain?.toLowerCase() || null;
      if (domain) {
        const [taken] = await many<{ n: number }>(tx, sql`select count(*)::int as n from branding_by_domain(${domain})`);
        if (taken.n > 0 && b.customDomain !== domain) throw new ConflictException('This domain is used by another workspace');
      }
      const sender = input.emailFromAddress?.toLowerCase() || null;
      const [r] = await tx
        .update(tenantBranding)
        .set({
          ...input,
          primaryColor: input.primaryColor?.toLowerCase() || null,
          accentColor: input.accentColor?.toLowerCase() || null,
          customDomain: domain,
          emailFromAddress: sender,
          // A new domain or sending domain has to be proven again.
          domainVerifiedAt: domain === b.customDomain ? b.domainVerifiedAt : null,
          domainToken: domain === b.customDomain ? b.domainToken : randomBytes(16).toString('hex'),
          emailDomainVerifiedAt: sender && b.emailFromAddress && emailDomain(sender) === emailDomain(b.emailFromAddress) ? b.emailDomainVerifiedAt : null,
          updatedAt: new Date(),
        })
        .where(eq(tenantBranding.id, b.id))
        .returning();
      return this.view(r);
    });
  }

  /** Check the DNS TXT record for the custom domain or the email sending domain. */
  async verify(auth: AuthContext, what: 'domain' | 'email') {
    const b = await this.database.run(auth, (tx) => this.row(tx, auth.tenantId));
    const host = what === 'domain' ? b.customDomain : b.emailFromAddress ? emailDomain(b.emailFromAddress) : null;
    if (!host) throw new BadRequestException(what === 'domain' ? 'Set the custom domain first' : 'Set the sender address first');
    const token = what === 'domain' ? b.domainToken! : b.emailDomainToken!;
    const records = await this.dns.lookup(`_nextgen-verify.${host}`);
    if (!txtMatches(records, token)) throw new ConflictException(`The TXT record ${txtRecord(token)} was not found on _nextgen-verify.${host}. DNS changes can take a while to show.`);
    return this.database.run(auth, async (tx) => {
      const [r] = await tx
        .update(tenantBranding)
        .set(what === 'domain' ? { domainVerifiedAt: new Date() } : { emailDomainVerifiedAt: new Date() })
        .where(eq(tenantBranding.id, b.id))
        .returning();
      return this.view(r);
    });
  }

  /** Branding for the login page of a verified custom domain. */
  async byHost(host: string) {
    const [r] = await this.database.run({}, (tx) => many(tx, sql`select * from branding_by_domain(${host.toLowerCase()})`));
    return r ?? null;
  }

  /** Branding used when sending email for a workspace. */
  async forMail(tenantId: string) {
    const [b] = await this.database.run({ tenantId }, (tx) => tx.select().from(tenantBranding));
    if (!b) return null;
    return { productName: b.productName, color: b.primaryColor, fromName: b.emailFromName, fromAddress: b.emailFromAddress && b.emailDomainVerifiedAt ? b.emailFromAddress : null };
  }

  // ---- the workspace's partner -------------------------------------------------------------------

  partner(auth: AuthContext) {
    return this.database.run(auth, async (tx) => (await many(tx, sql`select * from tenant_partner()`))[0] ?? null);
  }

  setPartner(auth: AuthContext, code: string | null) {
    return this.database.run(auth, async (tx) => {
      try {
        await tx.execute(sql`select tenant_set_partner(${code})`);
      } catch (err) {
        const msg = (err as { cause?: { message?: string } }).cause?.message ?? String(err);
        if (msg.includes('Only the workspace owner')) throw new ForbiddenException('Only the workspace owner can choose the partner');
        if (msg.includes('No active partner')) throw new NotFoundException('No active partner with this code');
        throw err;
      }
      return (await many(tx, sql`select * from tenant_partner()`))[0] ?? null;
    });
  }

  // ---- partner portal ----------------------------------------------------------------------------

  async portal(auth: AuthContext) {
    return this.database.run({ userId: auth.userId }, async (tx) => {
      const me = await many(tx, sql`select * from partner_of_current_user()`);
      if (!me.length) throw new ForbiddenException('You are not a member of a partner');
      const clients = (await many<{ active_users: string }>(tx, sql`select * from partner_clients()`)).map((c) => ({ ...c, active_users: Number(c.active_users) }));
      const commissions = await many<{ amount: number; status: string }>(tx, sql`select * from partner_commissions_mine()`);
      return {
        partners: me,
        clients,
        commissions,
        totals: { accrued: commissions.filter((c) => c.status === 'accrued').reduce((a, c) => a + c.amount, 0), paid: commissions.filter((c) => c.status === 'paid').reduce((a, c) => a + c.amount, 0) },
      };
    });
  }

  /** A partner user creates a client workspace that they own and that the partner manages. */
  async createClient(auth: AuthContext, input: z.infer<typeof clientSchema>) {
    const ok = await this.database.run({ userId: auth.userId }, async (tx) => (await many<{ ok: boolean }>(tx, sql`select partner_can_provision(${input.partnerId}) as ok`))[0].ok);
    if (!ok) throw new ForbiddenException('You cannot create workspaces for this partner');
    const [taken] = await this.database.run({}, (tx) => many<{ exists: boolean }>(tx, sql`select tenant_slug_exists(${input.slug}) as exists`));
    if (taken.exists) throw new ConflictException('This workspace URL is already taken');
    const r = await this.database.run({}, (tx) =>
      provisionTenant(tx, {
        tenant: { slug: input.slug, name: input.workspaceName, industry: input.industry ?? null, partnerId: input.partnerId },
        company: { name: input.companyName, gstin: input.gstin ?? null },
        owner: { userId: auth.userId },
      }),
    );
    return { tenantId: r.tenantId, slug: input.slug };
  }

  // ---- platform administration -------------------------------------------------------------------

  private admin<T>(auth: AuthContext, fn: (tx: Transaction) => Promise<T>) {
    return this.database.run({ userId: auth.userId }, async (tx) => {
      await tx.execute(sql`select set_config('app.platform_admin', 'true', true)`);
      return fn(tx);
    });
  }

  adminPartners(auth: AuthContext) {
    return this.admin(auth, async (tx) => (await many<{ clients: string; members: string }>(tx, sql`select * from admin_partners()`)).map((r) => ({ ...r, clients: Number(r.clients), members: Number(r.members) })));
  }

  adminSave(auth: AuthContext, id: string | null, p: z.infer<typeof partnerSchema>) {
    return this.admin(auth, async (tx) => {
      try {
        const [r] = await many<{ id: string }>(tx, sql`select admin_save_partner(${id}::uuid, ${p.code}, ${p.name}, ${p.kind}, ${p.email}, ${p.gstin ?? null}, ${p.commissionPct}::float8, ${p.certified}, ${p.status}) as id`);
        if (!r.id) throw new NotFoundException('Partner not found');
        return { id: r.id };
      } catch (err) {
        if (String((err as { cause?: { message?: string } }).cause?.message ?? err).includes('partners_code_uq')) throw new ConflictException('This partner code is in use');
        throw err;
      }
    });
  }

  adminAddMember(auth: AuthContext, partnerId: string, m: z.infer<typeof memberSchema>) {
    return this.admin(auth, async (tx) => {
      try {
        await tx.execute(sql`select admin_add_partner_member(${partnerId}::uuid, ${m.email}, ${m.role})`);
      } catch (err) {
        if (String((err as { cause?: { message?: string } }).cause?.message ?? err).includes('No user with this email')) throw new NotFoundException('No user with this email: they must sign up first');
        throw err;
      }
      return { ok: true };
    });
  }

  adminAccrue(auth: AuthContext) {
    return this.admin(auth, async (tx) => ({ accrued: (await many<{ n: number }>(tx, sql`select admin_accrue_commissions() as n`))[0].n }));
  }

  adminPay(auth: AuthContext, partnerId: string, reference: string) {
    return this.admin(auth, async (tx) => ({ paid: (await many<{ n: number }>(tx, sql`select admin_pay_commissions(${partnerId}::uuid, ${reference}) as n`))[0].n }));
  }
}
