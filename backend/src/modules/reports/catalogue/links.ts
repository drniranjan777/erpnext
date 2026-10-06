import type { LinkReport, ReportDef } from '../report-types';

const link = (key: string, title: string, category: LinkReport['category'], description: string, permission: LinkReport['permission'], href: string): ReportDef => ({ kind: 'link', key, title, category, description, permission, href });

/** Reports that have their own screens; listed so the catalogue is complete. */
export const LINK_REPORTS: ReportDef[] = [
  link('trial-balance', 'Trial balance', 'finance', 'Opening, movement and closing per account.', 'accounting.accounts.read', '/accounting/trial-balance'),
  link('profit-and-loss', 'Profit and loss', 'finance', 'Schedule III statement of profit and loss.', 'accounting.accounts.read', '/accounting/statements?tab=pl'),
  link('balance-sheet', 'Balance sheet', 'finance', 'Schedule III balance sheet.', 'accounting.accounts.read', '/accounting/statements?tab=bs'),
  link('cash-flow', 'Cash flow statement', 'finance', 'Indirect method, from the ledger.', 'accounting.accounts.read', '/accounting/statements?tab=cf'),
  link('ratios', 'Financial ratios', 'finance', 'Liquidity, leverage, turnover and profitability.', 'accounting.accounts.read', '/accounting/statements?tab=ratios'),
  link('general-ledger', 'General ledger', 'finance', 'Entries of any account or party.', 'accounting.accounts.read', '/accounting/ledger'),
  link('day-book', 'Day book', 'finance', 'All vouchers of a period.', 'accounting.accounts.read', '/accounting/day-book'),
  link('receivables-ageing', 'Receivables ageing', 'finance', 'What customers owe, by age bucket.', 'accounting.accounts.read', '/accounting/ageing?side=receivable'),
  link('payables-ageing', 'Payables ageing', 'finance', 'What you owe vendors, by age bucket.', 'accounting.accounts.read', '/accounting/ageing?side=payable'),
  link('bank-reconciliation', 'Bank reconciliation', 'finance', 'Statement lines matched against the books.', 'accounting.bank.reconcile', '/accounting/bank'),
  link('budget-vs-actual', 'Budget vs actual', 'finance', 'Spend against budget per account and cost centre.', 'accounting.accounts.read', '/accounting/budgets'),
  link('fixed-assets', 'Fixed asset register', 'finance', 'Assets with cost, depreciation and book value.', 'assets.register.read', '/assets'),
  link('tds-summary', 'TDS', 'finance', 'Tax deducted by section and quarter, challans, 16A.', 'accounting.accounts.read', '/accounting/tds'),
  link('finance-insights', 'Finance insights', 'finance', 'Anomalies and the cash forecast.', 'accounting.accounts.read', '/accounting/insights'),
  link('gstr1', 'GSTR-1', 'gst', 'Outward supplies return with JSON for the portal.', 'gst.reports.read', '/gst/gstr1'),
  link('gstr3b', 'GSTR-3B', 'gst', 'Summary return with ITC set-off.', 'gst.reports.read', '/gst/gstr3b'),
  link('gstr2b', 'GSTR-2B reconciliation', 'gst', 'Supplier filings matched against your bills.', 'gst.reports.read', '/gst/gstr2b'),
  link('hsn-summary', 'HSN summary', 'gst', 'Outward supplies by HSN and rate.', 'gst.reports.read', '/gst/returns'),
  link('itc-04', 'ITC-04', 'gst', 'Goods sent to and received from job workers.', 'gst.reports.read', '/gst/itc-04'),
  link('einvoices', 'E-invoices', 'gst', 'IRNs generated and cancelled.', 'gst.reports.read', '/gst/einvoices'),
  link('eway-bills', 'E-way bills', 'gst', 'E-way bills with validity.', 'gst.reports.read', '/gst/eway-bills'),
  link('vendor-performance', 'Vendor performance', 'purchase', 'Delivery, quality and price scores per vendor.', 'purchase.orders.read', '/purchase/vendor-performance'),
  link('stock-ledger', 'Stock ledger', 'inventory', 'Every movement of an item with running balance.', 'inventory.stock.read', '/inventory/ledger'),
  link('scrap-trends', 'Scrap and rejects', 'production', 'Rejects by work centre, reason and week with alerts.', 'manufacturing.production.read', '/manufacturing/scrap'),
];
