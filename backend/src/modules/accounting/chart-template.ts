/**
 * Default chart of accounts for an Indian manufacturing company, laid out on Schedule III of
 * the Companies Act. Groups carry the report line; posting accounts carry the system keys
 * the posting rules use. Companies can add accounts and rename anything.
 */

export type Nature = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export interface TemplateAccount {
  code: string;
  name: string;
  nature: Nature;
  group?: boolean;
  key?: string;
  reportLine?: string;
  control?: boolean;
  type?: 'bank' | 'cash';
  manual?: boolean;
  children?: TemplateAccount[];
}

const g = (code: string, name: string, nature: Nature, reportLine: string, children: TemplateAccount[]): TemplateAccount => ({ code, name, nature, group: true, reportLine, children });
const a = (code: string, name: string, nature: Nature, key?: string, extra: Partial<TemplateAccount> = {}): TemplateAccount => ({ code, name, nature, key, ...extra });

export const CHART_TEMPLATE: TemplateAccount[] = [
  g('1000', 'Equity', 'equity', 'bs.equity', [
    a('1100', 'Share capital', 'equity', 'share_capital', { reportLine: 'bs.equity.share_capital' }),
    g('1200', 'Reserves and surplus', 'equity', 'bs.equity.reserves', [
      a('1210', 'Retained earnings', 'equity', 'retained_earnings'),
      a('1220', 'Opening balance difference', 'equity', 'opening_balance'),
    ]),
  ]),
  g('2000', 'Non-current liabilities', 'liability', 'bs.ncl', [a('2100', 'Long-term borrowings', 'liability', undefined, { reportLine: 'bs.ncl.borrowings' })]),
  g('3000', 'Current liabilities', 'liability', 'bs.cl', [
    a('3100', 'Short-term borrowings', 'liability', undefined, { reportLine: 'bs.cl.borrowings' }),
    g('3200', 'Trade payables', 'liability', 'bs.cl.trade_payables', [a('3210', 'Sundry creditors', 'liability', 'payable', { control: true })]),
    g('3300', 'Other current liabilities', 'liability', 'bs.cl.other', [
      a('3310', 'Goods received, not invoiced', 'liability', 'grni', { manual: false }),
      a('3320', 'Landed cost accrued', 'liability', 'landed_cost_accrued'),
      a('3330', 'Job-work charges accrued', 'liability', 'jobwork_accrued'),
      a('3340', 'Customs duty payable', 'liability', 'customs_payable'),
      a('3350', 'Advances from customers', 'liability', 'customer_advance'),
      a('3360', 'Salaries payable', 'liability', 'salary_payable'),
      a('3361', 'Provident fund payable', 'liability', 'pf_payable'),
      a('3362', 'ESI payable', 'liability', 'esi_payable'),
      a('3363', 'Professional tax payable', 'liability', 'pt_payable'),
      a('3364', 'Labour welfare fund payable', 'liability', 'lwf_payable'),
    ]),
    g('3400', 'Duties and taxes', 'liability', 'bs.cl.other', [
      a('3410', 'Output CGST', 'liability', 'gst_out_cgst'),
      a('3411', 'Output SGST / UTGST', 'liability', 'gst_out_sgst'),
      a('3412', 'Output IGST', 'liability', 'gst_out_igst'),
      a('3413', 'Output cess', 'liability', 'gst_out_cess'),
      a('3420', 'CGST payable on reverse charge', 'liability', 'gst_rcm_cgst'),
      a('3421', 'SGST payable on reverse charge', 'liability', 'gst_rcm_sgst'),
      a('3422', 'IGST payable on reverse charge', 'liability', 'gst_rcm_igst'),
      a('3423', 'Cess payable on reverse charge', 'liability', 'gst_rcm_cess'),
      a('3430', 'TDS payable', 'liability', 'tds_payable'),
      a('3431', 'TCS payable', 'liability', 'tcs_payable'),
      a('3440', 'GST payable (cash ledger)', 'liability', 'gst_payable'),
    ]),
    a('3500', 'Short-term provisions', 'liability', undefined, { reportLine: 'bs.cl.provisions' }),
  ]),
  g('4000', 'Non-current assets', 'asset', 'bs.nca', [
    g('4100', 'Property, plant and equipment', 'asset', 'bs.nca.ppe', [
      a('4110', 'Plant and machinery', 'asset', 'ppe_plant'),
      a('4120', 'Furniture and fixtures', 'asset'),
      a('4130', 'Vehicles', 'asset'),
      a('4140', 'Computers', 'asset'),
      a('4190', 'Accumulated depreciation', 'asset', 'accumulated_depreciation'),
    ]),
    a('4200', 'Capital work in progress', 'asset', 'cwip', { reportLine: 'bs.nca.cwip' }),
  ]),
  g('5000', 'Current assets', 'asset', 'bs.ca', [
    g('5100', 'Inventories', 'asset', 'bs.ca.inventories', [a('5110', 'Stock in hand', 'asset', 'stock', { manual: false }), a('5120', 'Work in progress', 'asset', 'wip', { manual: false })]),
    g('5200', 'Trade receivables', 'asset', 'bs.ca.trade_receivables', [a('5210', 'Sundry debtors', 'asset', 'receivable', { control: true })]),
    g('5300', 'Cash and cash equivalents', 'asset', 'bs.ca.cash', [
      a('5310', 'Cash in hand', 'asset', 'cash', { type: 'cash' }),
      g('5320', 'Bank accounts', 'asset', 'bs.ca.cash', []),
    ]),
    g('5400', 'Short-term loans and advances', 'asset', 'bs.ca.loans_advances', [
      a('5410', 'Advances to suppliers', 'asset', 'vendor_advance'),
      a('5420', 'TDS receivable', 'asset', 'tds_receivable'),
      a('5430', 'Loans and advances to employees', 'asset', 'employee_loans'),
    ]),
    g('5500', 'Other current assets', 'asset', 'bs.ca.other', [
      a('5510', 'Input CGST', 'asset', 'gst_in_cgst'),
      a('5511', 'Input SGST / UTGST', 'asset', 'gst_in_sgst'),
      a('5512', 'Input IGST', 'asset', 'gst_in_igst'),
      a('5513', 'Input cess', 'asset', 'gst_in_cess'),
    ]),
  ]),
  g('6000', 'Revenue from operations', 'income', 'pl.revenue', [
    a('6100', 'Sales: domestic', 'income', 'sales'),
    a('6110', 'Sales: export and SEZ', 'income', 'sales_export'),
    a('6120', 'Service income', 'income', 'sales_services'),
    a('6190', 'Sales returns and allowances', 'income', 'sales_returns'),
  ]),
  g('6500', 'Other income', 'income', 'pl.other_income', [
    a('6510', 'Discount received', 'income'),
    a('6520', 'Interest income', 'income', 'interest_income'),
    a('6530', 'Foreign exchange gain / loss', 'income', 'fx_gain_loss'),
    a('6540', 'Profit / loss on sale of assets', 'income', 'asset_disposal'),
    a('6590', 'Rounding off', 'income', 'round_off'),
  ]),
  g('7000', 'Cost of materials and goods', 'expense', 'pl.materials', [
    a('7100', 'Materials consumed', 'expense', 'materials_consumed'),
    a('7200', 'Cost of goods sold', 'expense', 'cogs'),
    a('7300', 'Purchase price variance', 'expense', 'ppv'),
    a('7400', 'Stock adjustments', 'expense', 'stock_adjustment'),
    a('7500', 'Production variances', 'expense', 'production_variance'),
    a('7600', 'Labour and overheads absorbed', 'expense', 'production_absorbed', { manual: false }),
  ]),
  g('8000', 'Employee benefits expense', 'expense', 'pl.employee', [
    a('8100', 'Salaries and wages', 'expense'),
    a('8110', 'Salaries and wages (payroll)', 'expense', 'payroll_salaries'),
    a('8120', 'Contribution to PF, ESI and welfare funds', 'expense', 'payroll_contributions'),
    a('8130', 'Gratuity and leave encashment', 'expense', 'gratuity_expense'),
  ]),
  g('8500', 'Finance costs', 'expense', 'pl.finance', [a('8510', 'Interest expense', 'expense'), a('8520', 'Bank charges', 'expense', 'bank_charges')]),
  g('9000', 'Depreciation and amortisation', 'expense', 'pl.depreciation', [a('9010', 'Depreciation', 'expense', 'depreciation')]),
  g('9500', 'Other expenses', 'expense', 'pl.other_expenses', [
    a('9510', 'Purchased services', 'expense', 'purchase_services'),
    a('9520', 'Consumables and other purchases', 'expense', 'purchase_expenses'),
    a('9530', 'Freight inward', 'expense'),
    a('9540', 'GST input credit not available', 'expense', 'itc_ineligible'),
    a('9550', 'Bad debts written off', 'expense', 'bad_debts'),
    a('9560', 'Rent', 'expense'),
    a('9570', 'Power and fuel', 'expense'),
    a('9580', 'Repairs and maintenance', 'expense'),
    a('9585', 'Maintenance spares consumed', 'expense', 'maintenance_consumed'),
    a('9590', 'Trade schemes and distributor claims', 'expense', 'trade_schemes'),
  ]),
];

/** System keys every company must have for posting. */
export const REQUIRED_KEYS = [
  'receivable', 'payable', 'stock', 'grni', 'cogs', 'materials_consumed', 'ppv', 'stock_adjustment', 'opening_balance', 'round_off',
  'sales', 'sales_export', 'sales_services', 'sales_returns', 'purchase_services', 'purchase_expenses', 'itc_ineligible',
  'gst_out_cgst', 'gst_out_sgst', 'gst_out_igst', 'gst_out_cess', 'gst_in_cgst', 'gst_in_sgst', 'gst_in_igst', 'gst_in_cess',
  'gst_rcm_cgst', 'gst_rcm_sgst', 'gst_rcm_igst', 'gst_rcm_cess', 'tds_payable', 'landed_cost_accrued', 'jobwork_accrued', 'customs_payable',
  'bank_charges', 'tds_receivable', 'bad_debts', 'cash', 'customer_advance', 'vendor_advance', 'interest_income', 'depreciation', 'accumulated_depreciation',
  'gst_payable', 'asset_disposal', 'cwip', 'ppe_plant', 'wip', 'production_variance', 'production_absorbed', 'maintenance_consumed',
  'salary_payable', 'pf_payable', 'esi_payable', 'pt_payable', 'lwf_payable', 'employee_loans', 'payroll_salaries', 'payroll_contributions', 'gratuity_expense', 'trade_schemes',
] as const;
export type SystemKey = (typeof REQUIRED_KEYS)[number];
