import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { appInstallations, connectorRecords, connectorRuns, GST_STATES, type Transaction } from '@nextgen/database';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { CryptoService } from '../../common/crypto.service';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { leadSchema, LeadsService } from '../crm/leads.service';
import { WebhooksService } from '../integrations/webhooks.service';
import { InvitationsService } from '../iam/invitations.service';
import { createPartySchema, PartiesService } from '../masters/parties.service';
import { SalesOrdersService } from '../sales/orders.service';
import { createOrderSchema } from '../sales/sales.schemas';
import { CATALOGUE, connectorDef, fromIndiaMart, fromShopify, genericSignatureOk, sampleDirectory, sampleLeads, sampleOrders, sandboxAwb, sandboxPaymentLink, shopifySignatureOk, tallyMastersXml, type ExternalLead, type ExternalOrder } from './connectors';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const SYSTEM: RequestMeta = { ip: null, userAgent: 'connector', requestId: 'connector' };

export const installSchema = z.object({ connector: z.string().min(2).max(40), mode: z.enum(['sandbox', 'live']).default('sandbox'), config: z.record(z.string(), z.string().max(500)).default({}), secrets: z.record(z.string(), z.string().max(10_000)).default({}) });
export const runSchema = z.object({ deliveryId: z.uuid().optional(), invoiceId: z.uuid().optional(), roleId: z.uuid().optional() });

interface RunResult {
  status: 'ok' | 'partial' | 'failed';
  stats: Record<string, number>;
  log: string[];
  output?: string | null;
  data?: Record<string, unknown>;
}

/**
 * The app marketplace: installs connectors with settings and encrypted credentials, runs their
 * actions (imports, exports, bookings, links, invites) and inbound webhooks, keeps every run with
 * its counts and log, and remembers which external record became which of ours so nothing is
 * imported twice. Imports raise connector.* events that webhooks and automations can follow.
 */
@Injectable()
export class MarketplaceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly orders: SalesOrdersService,
    private readonly parties: PartiesService,
    private readonly leads: LeadsService,
    private readonly invitations: InvitationsService,
    private readonly webhooks: WebhooksService,
  ) {}

  catalogue(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const inst = await tx.select().from(appInstallations);
      return CATALOGUE.map((c) => {
        const i = inst.find((x) => x.connector === c.key);
        return { ...c, installed: i ? { id: i.id, mode: i.mode, enabled: i.enabled, config: i.config, hasSecrets: !!i.secretsEncrypted, lastRunAt: i.lastRunAt, lastStatus: i.lastStatus, webhookPath: c.webhook ? `/api/v1/public/connectors/${i.id}/webhook` : null } : null };
      });
    });
  }

  install(auth: AuthContext, input: z.infer<typeof installSchema>) {
    const def = connectorDef(input.connector);
    if (!def) throw new NotFoundException('Unknown connector');
    const missing = def.fields.filter((f) => f.required && !f.secret && !input.config[f.key]);
    if (missing.length) throw new BadRequestException(`Fill in ${missing.map((f) => f.label).join(', ')}`);
    if (input.mode === 'live' && !def.local) {
      const secrets = def.fields.filter((f) => f.secret && !input.secrets[f.key]);
      if (secrets.length) throw new BadRequestException(`Live mode needs ${secrets.map((f) => f.label).join(', ')}`);
    }
    return this.database.run(auth, async (tx) => {
      const [existing] = await tx.select().from(appInstallations).where(eq(appInstallations.connector, def.key));
      const values = {
        mode: def.local ? 'live' : input.mode,
        config: input.config,
        secretsEncrypted: Object.keys(input.secrets).length ? this.crypto.encrypt(JSON.stringify(input.secrets)) : (existing?.secretsEncrypted ?? null),
      };
      const webhookSecret = randomBytes(24).toString('hex');
      const [r] = existing
        ? await tx.update(appInstallations).set({ ...values, enabled: true }).where(eq(appInstallations.id, existing.id)).returning()
        : await tx
            .insert(appInstallations)
            .values({ tenantId: auth.tenantId, connector: def.key, ...values, webhookSecretEncrypted: def.webhook ? this.crypto.encrypt(webhookSecret) : null, installedBy: auth.userId })
            .returning();
      // The webhook secret is shown once, when the connector is first installed.
      return { id: r.id, connector: def.key, mode: r.mode, webhookSecret: !existing && def.webhook ? webhookSecret : undefined, webhookPath: def.webhook ? `/api/v1/public/connectors/${r.id}/webhook` : null };
    });
  }

  setEnabled(auth: AuthContext, id: string, enabled: boolean) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.update(appInstallations).set({ enabled }).where(eq(appInstallations.id, id)).returning({ id: appInstallations.id });
      if (!r) throw new NotFoundException('Connector not installed');
      return { ok: true };
    });
  }

  runs(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) =>
      many(tx, sql`select r.id, r.action, r.status, r.stats, r.log, r.output is not null as "hasOutput", r.started_at as "startedAt", r.finished_at as "finishedAt", u.full_name as "by" from connector_runs r left join users u on u.id = r.triggered_by where r.installation_id = ${id} order by r.started_at desc limit 50`),
    );
  }

  async output(auth: AuthContext, runId: string) {
    const [r] = await this.database.run(auth, (tx) => tx.select({ output: connectorRuns.output, action: connectorRuns.action }).from(connectorRuns).where(eq(connectorRuns.id, runId)));
    if (!r?.output) throw new NotFoundException('This run produced no file');
    return r.output;
  }

  // ---- running actions ---------------------------------------------------------------------------

  private async installation(auth: AuthContext, id: string) {
    const [i] = await this.database.run(auth, (tx) => tx.select().from(appInstallations).where(eq(appInstallations.id, id)));
    if (!i) throw new NotFoundException('Connector not installed');
    if (!i.enabled) throw new ConflictException('The connector is switched off');
    return i;
  }

  private async record(auth: AuthContext, installationId: string, action: string, r: RunResult) {
    return this.database.run(auth, async (tx) => {
      const [run] = await tx
        .insert(connectorRuns)
        .values({ tenantId: auth.tenantId, installationId, action, status: r.status, stats: r.stats, log: r.log.slice(0, 200), output: r.output ?? null, finishedAt: new Date(), triggeredBy: auth.userId || null })
        .returning({ id: connectorRuns.id });
      await tx.update(appInstallations).set({ lastRunAt: new Date(), lastStatus: r.status }).where(eq(appInstallations.id, installationId));
      return { runId: run.id, ...r, output: undefined, hasOutput: !!r.output };
    });
  }

  async run(auth: AuthContext, installationId: string, action: string, input: z.infer<typeof runSchema>) {
    const inst = await this.installation(auth, installationId);
    const def = connectorDef(inst.connector)!;
    const a = def.actions.find((x) => x.key === action);
    if (!a) throw new NotFoundException('Unknown action');
    if (a.needs && !input[a.needs]) throw new BadRequestException(`Choose the ${a.needs === 'deliveryId' ? 'delivery note' : a.needs === 'invoiceId' ? 'invoice' : 'role for the new users'}`);
    if (inst.mode === 'live' && !def.local) {
      return this.record(auth, installationId, action, { status: 'failed', stats: {}, log: [`Live calls to ${def.name} need network access to its API, which this environment does not have. Use sandbox mode here.`] });
    }
    let result: RunResult;
    switch (`${def.key}:${action}`) {
      case 'tally:export_masters':
        result = await this.tallyExport(auth, inst.config.company);
        break;
      case 'shopify:import_orders':
      case 'amazon_seller:import_orders':
      case 'flipkart_seller:import_orders':
        result = await this.importOrders(auth, def.key, def.name, await this.sampleOrdersFor(auth, def.key));
        break;
      case 'indiamart:import_leads':
        result = await this.importLeads(auth, sampleLeads(todayIST()).map(fromIndiaMart));
        break;
      case 'shiprocket:create_shipment':
      case 'delhivery:create_shipment':
        result = await this.shipment(auth, def.key, input.deliveryId!);
        break;
      case 'razorpay_links:payment_link':
        result = await this.paymentLink(auth, input.invoiceId!);
        break;
      case 'google_workspace:sync_users':
      case 'microsoft_365:sync_users':
        result = await this.syncUsers(auth, sampleDirectory(inst.config.domain ?? inst.config.tenantDomain ?? 'example.in'), input.roleId!);
        break;
      default:
        throw new BadRequestException('Not supported');
    }
    return this.record(auth, installationId, action, result);
  }

  /** Inbound push (Shopify order webhook, IndiaMART push): verified against the installation's webhook secret. */
  async webhook(installationId: string, raw: Buffer, headers: Record<string, string | string[] | undefined>) {
    const [inst] = await this.database.run({}, (tx) => many<{ id: string; tenant_id: string; connector: string; enabled: boolean; webhook_secret_encrypted: string | null }>(tx, sql`select * from connector_installation(${installationId}::uuid)`));
    if (!inst?.webhook_secret_encrypted || !inst.enabled) throw new NotFoundException();
    const secret = this.crypto.decrypt(inst.webhook_secret_encrypted);
    const h = (k: string) => (Array.isArray(headers[k]) ? (headers[k] as string[])[0] : (headers[k] as string | undefined));
    const ok = inst.connector === 'shopify' ? shopifySignatureOk(raw, h('x-shopify-hmac-sha256'), secret) : genericSignatureOk(raw, h('x-nextgen-signature'), secret);
    if (!ok) throw new UnauthorizedException('Signature does not match');
    const owner = await this.database.run({ tenantId: inst.tenant_id }, (tx) => many<{ userId: string }>(tx, sql`select user_id as "userId" from memberships where is_owner and status = 'active' limit 1`));
    const auth = { tenantId: inst.tenant_id, userId: owner[0]?.userId ?? '', membershipId: '', sessionId: 'connector', permissions: new Set<string>() } as unknown as AuthContext;
    const body = JSON.parse(raw.toString('utf8')) as Record<string, any>;
    const def = connectorDef(inst.connector)!;
    const result =
      inst.connector === 'shopify'
        ? await this.importOrders(auth, def.key, def.name, [fromShopify(body)])
        : inst.connector === 'indiamart'
          ? await this.importLeads(auth, (Array.isArray(body.RESPONSE) ? body.RESPONSE : [body.RESPONSE ?? body]).map(fromIndiaMart))
          : null;
    if (!result) throw new BadRequestException('This connector does not accept pushes');
    return this.record(auth, inst.id, 'webhook', result);
  }

  // ---- connector work ----------------------------------------------------------------------------

  private async tallyExport(auth: AuthContext, company: string): Promise<RunResult> {
    return this.database.run(auth, async (tx) => {
      const parties = await many<{ name: string; isCustomer: boolean; gstin: string | null; stateCode: string | null }>(tx, sql`select name, is_customer as "isCustomer", gstin, state_code as "stateCode" from parties where is_active and (is_customer or is_vendor) order by name`);
      const items = await many<{ name: string; uom: string; hsn: string | null; gstRate: number | null }>(tx, sql`select i.name, u.code as uom, i.hsn_code as hsn, i.gst_rate::float8 as "gstRate" from items i join uoms u on u.id = i.base_uom_id where i.is_active order by i.name`);
      const xml = tallyMastersXml(company, parties.map((p) => ({ ...p, stateName: p.stateCode ? GST_STATES[p.stateCode] : null })), items);
      return { status: 'ok', stats: { ledgers: parties.length, stockItems: items.length }, log: [`${parties.length} ledgers and ${items.length} stock items exported for ${company}.`], output: xml };
    });
  }

  private async sampleOrdersFor(auth: AuthContext, connector: string) {
    const skus = await this.database.run(auth, (tx) => many<{ code: string }>(tx, sql`select code from items where is_active and type in ('finished_good', 'trading') order by created_at limit 2`));
    return sampleOrders(connector, skus.map((s) => s.code), todayIST());
  }

  /** Orders → draft sales orders for the channel's customer, items by SKU (= item code); each order once. */
  private async importOrders(auth: AuthContext, connector: string, channel: string, orders: ExternalOrder[]): Promise<RunResult> {
    const log: string[] = [];
    const stats = { received: orders.length, created: 0, skipped: 0, failed: 0 };
    const customerId = await this.channelCustomer(auth, connector, channel);
    for (const o of orders) {
      const seen = await this.database.run(auth, (tx) => tx.select({ id: connectorRecords.id }).from(connectorRecords).where(and(eq(connectorRecords.connector, connector), eq(connectorRecords.entityType, 'sales_order'), eq(connectorRecords.externalId, o.id))));
      if (seen.length) {
        stats.skipped++;
        continue;
      }
      const codes = [...new Set(o.lines.map((l) => l.sku))];
      const items = codes.length ? await this.database.run(auth, (tx) => many<{ id: string; code: string }>(tx, sql`select id, code from items where code in ${codes}`)) : [];
      const unknown = codes.filter((c) => !items.some((i) => i.code.toLowerCase() === c.toLowerCase()));
      if (unknown.length) {
        stats.failed++;
        log.push(`${o.name}: unknown SKU ${unknown.join(', ')}`);
        continue;
      }
      try {
        const so = (await this.orders.create(
          auth,
          createOrderSchema.parse({ customerId, customerPoNo: o.name.slice(0, 60), notes: `${channel} order ${o.name} · ${o.customer.name}${o.customer.email ? ` <${o.customer.email}>` : ''}${o.customer.phone ? ` · ${o.customer.phone}` : ''}`, lines: o.lines.map((l) => ({ itemId: items.find((i) => i.code.toLowerCase() === l.sku.toLowerCase())!.id, qty: String(l.qty), rate: String(l.price), description: l.title || null })) }),
          SYSTEM,
        )) as { id: string; number?: string };
        await this.database.run(auth, async (tx) => {
          await tx.insert(connectorRecords).values({ tenantId: auth.tenantId, connector, externalId: o.id, entityType: 'sales_order', entityId: so.id, data: { name: o.name, customer: o.customer } });
          await this.webhooks.emit(tx, auth.tenantId, 'connector.orders_imported', { connector, externalId: o.id, orderName: o.name, salesOrderId: so.id, customer: o.customer.name, lines: o.lines.length, amount: o.lines.reduce((a, l) => a + l.qty * l.price, 0) });
        });
        stats.created++;
        log.push(`${o.name} → draft sales order`);
      } catch (err) {
        stats.failed++;
        log.push(`${o.name}: ${(err as Error).message}`);
      }
    }
    return { status: stats.failed ? (stats.created ? 'partial' : 'failed') : 'ok', stats, log };
  }

  /** One consumer customer per sales channel, created on first use. */
  private async channelCustomer(auth: AuthContext, connector: string, channel: string) {
    const name = `${channel} customers`;
    const [p] = await this.database.run(auth, (tx) => many<{ id: string }>(tx, sql`select id from parties where name = ${name} limit 1`));
    if (p) return p.id;
    const [co] = await this.database.run(auth, (tx) => many<{ stateCode: string | null; city: string | null; pincode: string | null }>(tx, sql`select state_code as "stateCode", address->>'city' as city, address->>'pincode' as pincode from companies where deleted_at is null order by created_at limit 1`));
    const created = (await this.parties.create(auth, createPartySchema.parse({ name, isCustomer: true, gstRegistrationType: 'consumer', notes: `Orders from ${channel} (${connector})`, addresses: co?.pincode && co.stateCode ? [{ type: 'both', line1: `${channel} online orders`, city: co.city || 'Online', stateCode: co.stateCode, pincode: co.pincode, isDefault: true }] : [] }), SYSTEM)) as { id: string };
    return created.id;
  }

  private async importLeads(auth: AuthContext, leads: ExternalLead[]): Promise<RunResult> {
    const stats = { received: leads.length, created: 0, skipped: 0, failed: 0 };
    const log: string[] = [];
    for (const l of leads) {
      const seen = await this.database.run(auth, (tx) => tx.select({ id: connectorRecords.id }).from(connectorRecords).where(and(eq(connectorRecords.connector, 'indiamart'), eq(connectorRecords.entityType, 'lead'), eq(connectorRecords.externalId, l.id))));
      if (seen.length) {
        stats.skipped++;
        continue;
      }
      try {
        const lead = (await this.leads.create(auth, leadSchema.parse({ name: l.name, company: l.company ?? null, email: l.email ?? null, phone: l.phone ?? null, city: l.city ?? null, source: 'indiamart', sourceRef: l.id, product: l.product ?? null, requirement: l.message ?? null }))) as { id: string };
        await this.database.run(auth, async (tx) => {
          await tx.insert(connectorRecords).values({ tenantId: auth.tenantId, connector: 'indiamart', externalId: l.id, entityType: 'lead', entityId: lead.id, data: { name: l.name } });
          await this.webhooks.emit(tx, auth.tenantId, 'connector.leads_imported', { connector: 'indiamart', externalId: l.id, leadId: lead.id, name: l.name, company: l.company ?? null, product: l.product ?? null });
        });
        stats.created++;
        log.push(`${l.name}${l.company ? ` (${l.company})` : ''} → lead`);
      } catch (err) {
        stats.failed++;
        log.push(`${l.name}: ${(err as Error).message}`);
      }
    }
    return { status: stats.failed ? (stats.created ? 'partial' : 'failed') : 'ok', stats, log };
  }

  private shipment(auth: AuthContext, connector: string, deliveryId: string): Promise<RunResult> {
    return this.database.run(auth, async (tx) => {
      const [d] = await many<{ number: string | null; status: string; lrNo: string | null }>(tx, sql`select d.number, d.status, dn.lr_no as "lrNo" from delivery_notes dn join documents d on d.id = dn.id where dn.id = ${deliveryId}`);
      if (!d) throw new NotFoundException('Delivery note not found');
      if (d.status !== 'approved' && d.status !== 'completed') throw new ConflictException('Book a shipment for a submitted delivery note');
      if (d.lrNo) throw new ConflictException(`Already booked: ${d.lrNo}`);
      const s = sandboxAwb(connector, deliveryId);
      await tx.execute(sql`update delivery_notes set transporter = ${s.courier}, lr_no = ${s.awb}, lr_date = ${todayIST()}::date where id = ${deliveryId}`);
      await tx.insert(connectorRecords).values({ tenantId: auth.tenantId, connector, externalId: s.awb, entityType: 'shipment', entityId: deliveryId, data: s });
      return { status: 'ok', stats: { shipments: 1 }, log: [`${d.number}: ${s.courier} AWB ${s.awb}`], data: s };
    });
  }

  private paymentLink(auth: AuthContext, invoiceId: string): Promise<RunResult> {
    return this.database.run(auth, async (tx) => {
      const [i] = await many<{ number: string | null; status: string; due: number }>(tx, sql`select d.number, d.status, (si.grand_total - si.received_amount - si.credited_amount)::float8 as due from sales_invoices si join documents d on d.id = si.id where si.id = ${invoiceId}`);
      if (!i) throw new NotFoundException('Invoice not found');
      if (i.status === 'draft' || i.status === 'cancelled') throw new ConflictException('Create links for submitted invoices');
      if (i.due <= 0) throw new ConflictException('Nothing is due on this invoice');
      const url = sandboxPaymentLink(invoiceId);
      await tx.insert(connectorRecords).values({ tenantId: auth.tenantId, connector: 'razorpay_links', externalId: url, entityType: 'payment_link', entityId: invoiceId, data: { amount: i.due } }).onConflictDoNothing();
      return { status: 'ok', stats: { links: 1 }, log: [`${i.number}: ₹${i.due.toFixed(2)} → ${url}`], data: { url, amount: i.due } };
    });
  }

  private async syncUsers(auth: AuthContext, people: { email: string; name: string }[], roleId: string): Promise<RunResult> {
    const stats = { directory: people.length, invited: 0, skipped: 0 };
    const log: string[] = [];
    for (const p of people) {
      try {
        await this.invitations.create(auth, { email: p.email, fullName: p.name, roleIds: [roleId] }, SYSTEM);
        stats.invited++;
        log.push(`${p.email} invited`);
      } catch (err) {
        stats.skipped++;
        log.push(`${p.email}: ${(err as Error).message}`);
      }
    }
    return { status: 'ok', stats, log };
  }

  /** Records made by a connector (orders, leads, shipments, links). */
  records(auth: AuthContext, connector: string) {
    return this.database.run(auth, (tx) => tx.select().from(connectorRecords).where(eq(connectorRecords.connector, connector)).orderBy(desc(connectorRecords.createdAt)).limit(100));
  }
}
