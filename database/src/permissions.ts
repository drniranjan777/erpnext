/**
 * Permission catalog (`module.resource.action`). This file is the single source
 * of truth: `npm run db:seed` syncs it into the `permissions` table, and the
 * backend uses the same codes in @RequirePermissions().
 */
export const PERMISSIONS = {
  // Platform / IAM
  'iam.users.read': 'View users',
  'iam.users.manage': 'Invite, edit and disable users',
  'iam.roles.read': 'View roles and permissions',
  'iam.roles.manage': 'Create and edit roles',
  'platform.audit.read': 'View audit trail',
  'platform.settings.manage': 'Manage workspace settings',
  'platform.numbering.manage': 'Manage document number series',
  'platform.workflows.manage': 'Manage approval workflows',
  'platform.customization.manage': 'Manage custom fields and print formats',
  'platform.billing.manage': 'Manage subscription, plan and billing',
  'platform.integrations.manage': 'Manage API keys and webhooks',
  'platform.privacy.manage': 'Handle data protection (DPDP) requests',
  // Organisation
  'org.companies.read': 'View companies',
  'org.companies.manage': 'Create and edit companies',
  'org.branches.read': 'View branches and plants',
  'org.branches.manage': 'Create and edit branches and plants',
  // Masters
  'masters.items.read': 'View items, units, item groups and price lists',
  'masters.items.manage': 'Create and edit items',
  'masters.parties.read': 'View customers and vendors',
  'masters.parties.manage': 'Create and edit customers and vendors',
  'masters.setup.manage': 'Manage units, item groups and price lists',
  // Inventory
  'inventory.warehouses.read': 'View warehouses',
  'inventory.warehouses.manage': 'Create and edit warehouses',
  'inventory.stock.read': 'View stock levels, ledger and valuation',
  'inventory.entries.manage': 'Create and submit stock entries (opening, receipt, issue, transfer, adjustment)',
  'inventory.entries.cancel': 'Cancel posted stock entries',
  // Purchase
  'purchase.requisitions.read': 'View purchase requisitions',
  'purchase.requisitions.manage': 'Create, edit and submit purchase requisitions',
  'purchase.requisitions.cancel': 'Cancel and amend approved purchase requisitions',
  'purchase.orders.read': 'View purchase orders',
  'purchase.orders.manage': 'Create, edit and submit purchase orders',
  'purchase.orders.cancel': 'Cancel, amend and short-close purchase orders',
  'purchase.receipts.read': 'View goods receipts (GRN)',
  'purchase.receipts.manage': 'Create and submit goods receipts (GRN)',
  'purchase.receipts.cancel': 'Cancel posted goods receipts',
  'purchase.invoices.read': 'View purchase invoices, debit notes and landed costs',
  'purchase.invoices.manage': 'Create and submit purchase invoices, debit notes and landed costs',
  'purchase.invoices.cancel': 'Cancel posted purchase invoices, debit notes and landed costs',
  'purchase.rfq.read': 'View requests for quotation and comparisons',
  'purchase.rfq.manage': 'Create RFQs, record vendor quotes and award orders',
  // Sales
  'sales.quotations.read': 'View sales quotations',
  'sales.quotations.manage': 'Create, edit and submit sales quotations',
  'sales.orders.read': 'View sales orders',
  'sales.orders.manage': 'Create, edit and submit sales orders',
  'sales.orders.cancel': 'Cancel, amend and short-close sales orders',
  'sales.orders.credit_override': 'Submit orders above the customer credit limit (with a reason)',
  'sales.deliveries.read': 'View delivery notes',
  'sales.deliveries.manage': 'Create and post delivery notes (dispatch)',
  'sales.deliveries.cancel': 'Cancel posted delivery notes',
  'sales.invoices.read': 'View sales invoices, credit notes and receivables',
  'sales.invoices.manage': 'Create and submit sales invoices and credit notes',
  'sales.invoices.cancel': 'Cancel sales invoices and credit notes',
  'gst.einvoice.manage': 'Generate and cancel e-invoices (IRN) and e-way bills',
  'gst.reports.read': 'View GST reports: HSN summary, documents issued, ITC-04, e-invoice status',
  'gst.settings.manage': 'Change e-invoice and e-way bill settings',
  'jobwork.challans.read': 'View job-work challans and receipts',
  'jobwork.challans.manage': 'Send material to job workers and receive it back',
  'jobwork.challans.cancel': 'Cancel job-work challans and receipts',
  'accounting.accounts.read': 'View the chart of accounts, ledgers and trial balance',
  'accounting.accounts.manage': 'Create and edit accounts and cost centres',
  'accounting.journals.manage': 'Create and submit journal vouchers',
  'accounting.journals.cancel': 'Cancel posted journal vouchers',
  'accounting.money.manage': 'Record receipts, payments and contra entries; adjust advances; write off bad debts',
  'accounting.money.cancel': 'Cancel receipts, payments and contra entries; mark cheques bounced',
  'accounting.bank.reconcile': 'Import bank statements and reconcile them',
  'accounting.tax.manage': 'Prepare GST and TDS returns, reconcile GSTR-2B, record tax payments',
  'assets.register.read': 'View the fixed asset register and depreciation',
  'assets.register.manage': 'Add, capitalise, transfer and dispose of fixed assets; run depreciation',
  'accounting.budgets.manage': 'Create budgets and set budget control',
  'accounting.close.manage': 'Close the financial year and revalue foreign-currency balances',
  'accounting.settings.manage': 'Set up the books, lock periods and bring past documents into the ledger',
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionCode[];

export function permissionRows() {
  return ALL_PERMISSIONS.map((code) => {
    const [module, resource, action] = code.split('.');
    return { code, module, resource, action, description: PERMISSIONS[code] };
  });
}

/** Roles created for every new tenant. */
export const SYSTEM_ROLES: { name: string; description: string; permissions: PermissionCode[] }[] = [
  { name: 'Owner', description: 'Full access to the workspace', permissions: ALL_PERMISSIONS },
  {
    name: 'Administrator',
    description: 'Manages users, roles and organisation setup',
    permissions: ALL_PERMISSIONS.filter((p) => p !== 'platform.settings.manage' && p !== 'platform.billing.manage'),
  },
  {
    name: 'Auditor',
    description: 'Read-only access to books, documents and the audit trail',
    permissions: ALL_PERMISSIONS.filter((p) => p.endsWith('.read')),
  },
  {
    name: 'Viewer',
    description: 'Read-only access',
    permissions: ALL_PERMISSIONS.filter((p) => p.endsWith('.read')),
  },
];
