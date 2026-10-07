import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { companies, itemGroups, tenants, warehouses, workCenters } from '@nextgen/database';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { loadPermissions } from '../../common/guards';
import { DatabaseService } from '../../database/database.service';
import { TEMPLATES } from './templates';

export interface Step {
  key: string;
  label: string;
  hint: string;
  done: boolean;
  optional: boolean;
  href: string;
}

const MANUFACTURING = new Set(['engineering', 'auto-components', 'machinery', 'plastic', 'electronics', 'textile', 'furniture', 'packaging', 'pharma', 'chemical', 'paint', 'lubricants', 'cosmetics', 'fmcg', 'food']);

/**
 * Getting a workspace ready: a checklist computed from what is really there, and industry
 * templates that add the item groups, stores and work centres a business of that kind needs.
 */
@Injectable()
export class OnboardingService {
  constructor(private readonly database: DatabaseService) {}

  progress(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const [t] = await tx.select({ industry: tenants.industry }).from(tenants).where(eq(tenants.id, auth.tenantId));
      const one = async (q: ReturnType<typeof sql>) => Number((await tx.execute<{ n: string }>(q)).rows[0]?.n ?? 0);
      const counts = {
        gstin: await one(sql`select count(*) as n from companies where gstin is not null and deleted_at is null`),
        books: await one(sql`select count(*) as n from accounting_settings`),
        warehouses: await one(sql`select count(*) as n from warehouses where is_active`),
        items: await one(sql`select count(*) as n from items where deleted_at is null`),
        customers: await one(sql`select count(*) as n from parties where is_customer and deleted_at is null`),
        vendors: await one(sql`select count(*) as n from parties where is_vendor and deleted_at is null`),
        opening: await one(sql`select count(*) as n from stock_entries e join documents d on d.id = e.id where e.purpose = 'opening_stock' and d.status = 'approved'`),
        members: await one(sql`select count(*) as n from memberships where status = 'active'`),
        boms: await one(sql`select count(*) as n from boms b join documents d on d.id = b.id where d.status = 'approved'`),
        rules: await one(sql`select count(*) as n from approval_rules where is_active`),
        sales: await one(sql`select count(*) as n from documents where doc_type in ('sales_invoice', 'sales_order') and status <> 'draft'`),
        purchases: await one(sql`select count(*) as n from documents where doc_type in ('purchase_order', 'purchase_invoice') and status <> 'draft'`),
      };
      const manufacturing = MANUFACTURING.has(t?.industry ?? '');
      const steps: Step[] = [
        { key: 'company', label: 'Add your company GSTIN and address', hint: 'Needed for tax invoices, e-invoices and returns.', done: counts.gstin > 0, optional: false, href: '/settings/companies' },
        { key: 'template', label: 'Set up stores and groups for your industry', hint: 'Adds finished-goods, rejected and scrap stores, item groups and work centres.', done: counts.warehouses >= 4, optional: false, href: '/setup' },
        { key: 'items', label: 'Add your items', hint: 'Type them in, or import from Excel or Tally.', done: counts.items >= 5, optional: false, href: '/masters/items' },
        { key: 'parties', label: 'Add customers and vendors', hint: 'With GSTIN, credit terms and addresses.', done: counts.customers > 0 && counts.vendors > 0, optional: false, href: '/masters/parties' },
        { key: 'opening', label: 'Enter opening stock', hint: 'Quantities and values on the day you start.', done: counts.opening > 0, optional: false, href: '/inventory/stock-entries/new' },
        { key: 'books', label: 'Set up the books', hint: 'Creates the Schedule III chart of accounts from your start date.', done: counts.books > 0, optional: false, href: '/accounting/settings' },
        ...(manufacturing ? [{ key: 'bom', label: 'Define a bill of materials', hint: 'What goes into what you make, and how.', done: counts.boms > 0, optional: false, href: '/manufacturing/boms/new' }] : []),
        { key: 'team', label: 'Invite your team', hint: 'Give each person a role so they see only their work.', done: counts.members > 1, optional: false, href: '/settings/users' },
        { key: 'approvals', label: 'Set approval rules', hint: 'For example, POs above ₹1 lakh need the owner.', done: counts.rules > 0, optional: true, href: '/settings/approval-workflows' },
        { key: 'first', label: 'Record your first order or invoice', hint: 'Sales or purchase; everything else follows from it.', done: counts.sales + counts.purchases > 0, optional: true, href: '/sales/orders/new' },
      ];
      const required = steps.filter((s) => !s.optional);
      return { industry: t?.industry ?? null, steps, done: required.filter((s) => s.done).length, total: required.length, complete: required.every((s) => s.done) };
    });
  }

  templates() {
    return Object.entries(TEMPLATES).map(([key, t]) => ({
      key,
      label: t.label,
      itemGroups: t.itemGroups.map(([code, name]) => ({ code, name })),
      warehouses: t.warehouses.map(([code, name, type]) => ({ code, name, type })),
      workCenters: t.workCenters.map(([code, name, kind]) => ({ code, name, kind })),
    }));
  }

  /** Adds what the template has and the workspace lacks; existing codes are left alone. */
  async apply(auth: AuthContext, industry: string) {
    const tpl = TEMPLATES[industry];
    if (!tpl) throw new BadRequestException({ message: 'Unknown industry', errors: [{ path: 'industry', message: 'Unknown industry' }] });
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    if (!perms.has('masters.setup.manage') || !perms.has('inventory.warehouses.manage')) throw new ForbiddenException('Setting up masters needs the masters setup and warehouse permissions');
    const canWc = perms.has('manufacturing.engineering.manage');
    return this.database.run(auth, async (tx) => {
      const [company] = await tx.select({ id: companies.id }).from(companies).where(isNull(companies.deletedAt)).orderBy(asc(companies.createdAt)).limit(1);
      const by = { createdBy: auth.userId, updatedBy: auth.userId };
      const groups = tpl.itemGroups.length
        ? await tx.insert(itemGroups).values(tpl.itemGroups.map(([code, name]) => ({ tenantId: auth.tenantId, code, name, ...by }))).onConflictDoNothing().returning({ code: itemGroups.code })
        : [];
      const stores = tpl.warehouses.length
        ? await tx
            .insert(warehouses)
            .values(tpl.warehouses.map(([code, name, type, nettable]) => ({ tenantId: auth.tenantId, companyId: company.id, code, name, type, isNettable: nettable, ...by })))
            .onConflictDoNothing()
            .returning({ code: warehouses.code })
        : [];
      const wcs =
        canWc && tpl.workCenters.length
          ? await tx
              .insert(workCenters)
              .values(tpl.workCenters.map(([code, name, kind, labour, machine, overhead]) => ({ tenantId: auth.tenantId, companyId: company.id, code, name, kind, labourRate: String(labour), machineRate: String(machine), overheadRate: String(overhead), ...by })))
              .onConflictDoNothing()
              .returning({ code: workCenters.code })
          : [];
      await tx.update(tenants).set({ industry }).where(eq(tenants.id, auth.tenantId));
      return { added: { itemGroups: groups.map((g) => g.code), warehouses: stores.map((w) => w.code), workCenters: wcs.map((w) => w.code) }, skippedWorkCenters: !canWc && tpl.workCenters.length > 0 };
    });
  }
}
