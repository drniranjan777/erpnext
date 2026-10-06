import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import {
  GST_STATES,
  itemGroups,
  items,
  itemUomConversions,
  parties,
  type Transaction,
  uoms,
  warehouses,
} from '@nextgen/database';
import { inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import type { RequestMeta } from '../../common/request-meta';
import { createStockEntrySchema } from '../inventory/inventory.schemas';
import { StockEntriesService } from '../inventory/stock-entries.service';
import { createItemSchema, ITEM_TYPES, ItemsService } from '../masters/items.service';
import { createPartySchema, PartiesService } from '../masters/parties.service';
import { date, decimal, integer, stateCode, text, unitKey, ValueError, yesNo } from './values';

// ---- shared types ----------------------------------------------------------------

export interface Column {
  key: string;
  label: string;
  required?: boolean;
  help?: string;
  example?: string;
  /** Other header spellings that map to this column (normalised form). */
  aliases?: string[];
}

export interface CellError {
  column: string | null;
  message: string;
}

export interface RowResult {
  rowNo: number;
  status: 'created' | 'skipped' | 'error';
  /** What the row is, for display ("ITM00012 · Copper wire"). */
  label: string;
  message?: string;
  errors: CellError[];
  ref?: { id: string; code: string | null };
}

export interface ImportRow {
  rowNo: number;
  values: Record<string, string>;
}

export interface ImportOptions {
  defaultItemType?: (typeof ITEM_TYPES)[number];
  /** Opening stock: posting date and whether to post (approve) the entries straight away. */
  postingDate?: string;
  post?: boolean;
}

export interface RunContext {
  tx: Transaction;
  auth: AuthContext;
  meta: RequestMeta;
  options: ImportOptions;
}

export interface Importer {
  entity: string;
  title: string;
  columns: Column[];
  /** Extra value lists printed on the template's help sheet. */
  lists(): Record<string, string[]>;
  run(ctx: RunContext, rows: ImportRow[]): Promise<RowResult[]>;
}

/** Collects per-column parse errors while building an input. */
class RowReader {
  readonly errors: CellError[] = [];
  constructor(private readonly values: Record<string, string>) {}

  raw(key: string) {
    return this.values[key]?.trim() ?? '';
  }

  get<T>(key: string, parse: (v: string | undefined) => T, required?: string): T | null {
    const v = this.values[key];
    if (required && !v?.trim()) {
      this.errors.push({ column: key, message: required });
      return null;
    }
    try {
      return parse(v);
    } catch (e) {
      if (e instanceof ValueError) {
        this.errors.push({ column: key, message: e.message });
        return null;
      }
      throw e;
    }
  }

  fail(column: string | null, message: string) {
    this.errors.push({ column, message });
  }
}

const camelToSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Maps an API validation path ("addresses.0.stateCode") to a template column. */
function columnFor(path: string, map: Record<string, string>): string | null {
  if (map[path]) return map[path];
  const prefix = Object.keys(map).find((k) => k.endsWith('*') && path.startsWith(k.slice(0, -1)));
  if (prefix) return map[prefix];
  return camelToSnake(path.split('.').pop() ?? path) || null;
}

/** Turns anything a service throws into cell errors. */
export function errorsFrom(e: unknown, map: Record<string, string>): CellError[] {
  if (e instanceof HttpException) {
    const body = e.getResponse() as { message?: string | string[]; errors?: { path: string; message: string }[] } | string;
    if (typeof body === 'object' && body.errors?.length) return body.errors.map((x) => ({ column: columnFor(x.path, map), message: x.message }));
    const msg = typeof body === 'string' ? body : Array.isArray(body.message) ? body.message.join('; ') : (body.message ?? e.message);
    return [{ column: null, message: msg }];
  }
  const pg = e as { code?: string; detail?: string; cause?: { code?: string; detail?: string } };
  const code = pg.code ?? pg.cause?.code;
  if (code === '23505') return [{ column: null, message: 'Duplicate: a record with the same code or number already exists' }];
  throw e;
}

function zodErrors(error: z.ZodError, map: Record<string, string>): CellError[] {
  return error.issues.map((i) => ({ column: columnFor(i.path.join('.'), map), message: i.message }));
}

/** Runs `fn` in a savepoint so one bad row doesn't abort the import. */
async function savepoint<T>(tx: Transaction, fn: (sp: Transaction) => Promise<T>) {
  return tx.transaction((sp) => fn(sp));
}

// ---- Items -------------------------------------------------------------------------

const TYPE_SYNONYMS: Record<string, (typeof ITEM_TYPES)[number]> = {
  rm: 'raw_material',
  raw: 'raw_material',
  'raw materials': 'raw_material',
  pm: 'packing_material',
  packing: 'packing_material',
  packaging: 'packing_material',
  sfg: 'semi_finished',
  wip: 'semi_finished',
  'semi finished goods': 'semi_finished',
  fg: 'finished_good',
  'finished goods': 'finished_good',
  'trading goods': 'trading',
  traded: 'trading',
  consumables: 'consumable',
  spares: 'spare',
  'spare parts': 'spare',
  services: 'service',
  'capital goods': 'asset',
  'by product': 'by_product',
  byproduct: 'by_product',
};

function itemType(v: string | undefined): (typeof ITEM_TYPES)[number] | null {
  if (!v?.trim()) return null;
  const t = v.trim().toLowerCase().replace(/[_-]+/g, ' ');
  const direct = ITEM_TYPES.find((k) => k.replace(/_/g, ' ') === t || `${k.replace(/_/g, ' ')}s` === t);
  if (direct) return direct;
  if (TYPE_SYNONYMS[t]) return TYPE_SYNONYMS[t];
  throw new ValueError(`Unknown type. Use one of: ${ITEM_TYPES.map((k) => k.replace(/_/g, ' ')).join(', ')}`);
}

const ITEM_PATHS: Record<string, string> = {
  baseUomId: 'base_unit',
  purchaseUomId: 'purchase_unit',
  salesUomId: 'purchase_unit',
  groupId: 'group',
  'conversions*': 'purchase_unit_factor',
  'barcodes*': 'barcode',
  isNilRatedOrExempt: 'nil_rated',
};

@Injectable()
export class ItemsImporter implements Importer {
  readonly entity = 'items';
  readonly title = 'Items';
  readonly columns: Column[] = [
    { key: 'code', label: 'Item code', help: 'Leave blank to number automatically (ITM00001…). Existing codes are skipped.', example: 'RM-PP-H110', aliases: ['item_code', 'sku', 'part_no', 'part_number'] },
    { key: 'name', label: 'Item name', required: true, example: 'PP homopolymer granules H110', aliases: ['item_name', 'name_of_item', 'item', 'description_of_goods', 'product_name'] },
    { key: 'type', label: 'Type', help: 'raw material, packing material, semi finished, finished good, trading, consumable, spare, service, asset, scrap, by product. Blank = the type chosen on the import screen.', example: 'raw material', aliases: ['item_type', 'category_type'] },
    { key: 'group', label: 'Item group', help: 'Group code or name (must exist).', example: 'RM', aliases: ['item_group', 'group_name', 'category', 'stock_group'] },
    { key: 'base_unit', label: 'Unit', required: true, help: 'Stock unit code: NOS, PCS, KG, LTR, MTR, BOX… (Kgs, Nos, Pcs also work).', example: 'KG', aliases: ['uom', 'unit', 'base_uom', 'units', 'unit_of_measure', 'stock_unit'] },
    { key: 'purchase_unit', label: 'Purchase unit', help: 'If you buy in a different unit, e.g. BAG.', example: 'BAG', aliases: ['purchase_uom', 'alternate_unit'] },
    { key: 'purchase_unit_factor', label: 'Base units per purchase unit', help: 'e.g. 25 if 1 BAG = 25 KG.', example: '25', aliases: ['conversion', 'conversion_factor', 'factor'] },
    { key: 'hsn_code', label: 'HSN/SAC', help: '4, 6 or 8 digits.', example: '39021000', aliases: ['hsn', 'hsn_sac', 'sac', 'hsn_sac_code', 'hsn_code_number'] },
    { key: 'gst_rate', label: 'GST %', help: '0, 0.25, 3, 5, 12, 18, 28 or 40.', example: '18', aliases: ['gst', 'gst_percent', 'gst_rate_percent', 'tax_rate', 'igst_rate', 'igst_percent', 'rate_of_tax'] },
    { key: 'nil_rated', label: 'Nil rated / exempt', help: 'Yes or No.', example: 'No', aliases: ['exempt', 'is_exempt'] },
    { key: 'track_batch', label: 'Batch tracking', help: 'Yes or No.', example: 'Yes', aliases: ['batch', 'batch_wise', 'maintain_batches'] },
    { key: 'has_expiry', label: 'Has expiry', help: 'Yes needs batch tracking.', example: 'No', aliases: ['expiry', 'track_expiry'] },
    { key: 'shelf_life_days', label: 'Shelf life (days)', example: '', aliases: ['shelf_life'] },
    { key: 'track_serial', label: 'Serial numbers', help: 'Yes or No. Needs a whole-number unit (NOS, PCS).', example: 'No', aliases: ['serial', 'serial_no', 'track_serial_no'] },
    { key: 'valuation_method', label: 'Valuation', help: 'Average or FIFO. Blank = average.', example: 'Average', aliases: ['valuation', 'costing_method'] },
    { key: 'reorder_level', label: 'Reorder level', example: '500', aliases: ['reorder', 'min_stock', 'minimum_stock'] },
    { key: 'reorder_qty', label: 'Reorder quantity', example: '2000', aliases: ['reorder_quantity', 'order_qty'] },
    { key: 'min_order_qty', label: 'Minimum order qty', aliases: ['moq'] },
    { key: 'lead_time_days', label: 'Lead time (days)', aliases: ['lead_time'] },
    { key: 'standard_cost', label: 'Standard cost', help: 'Per base unit, ₹.', example: '98.50', aliases: ['cost', 'cost_price', 'purchase_rate', 'purchase_price'] },
    { key: 'selling_rate', label: 'Selling rate', help: 'Per base unit, ₹, before GST.', aliases: ['sale_rate', 'selling_price', 'sale_price', 'rate'] },
    { key: 'mrp', label: 'MRP', aliases: ['mrp_rate'] },
    { key: 'brand', label: 'Brand', aliases: ['make', 'manufacturer'] },
    { key: 'barcode', label: 'Barcode', help: 'EAN / UPC / your own code.', aliases: ['ean', 'upc', 'bar_code'] },
    { key: 'description', label: 'Description', aliases: ['specification', 'remarks', 'details'] },
  ];

  constructor(private readonly itemsService: ItemsService) {}

  lists() {
    return { 'Item types': ITEM_TYPES.map((t) => t.replace(/_/g, ' ')), 'GST rates': ['0', '0.25', '3', '5', '12', '18', '28', '40'] };
  }

  async run({ tx, auth, meta, options }: RunContext, rows: ImportRow[]): Promise<RowResult[]> {
    const unitRows = await tx.select({ id: uoms.id, code: uoms.code }).from(uoms);
    const unitByCode = new Map(unitRows.map((u) => [u.code.toUpperCase(), u.id]));
    const groupRows = await tx.select({ id: itemGroups.id, code: itemGroups.code, name: itemGroups.name }).from(itemGroups);
    const groupBy = new Map<string, string>();
    for (const g of groupRows) {
      groupBy.set(g.code.toLowerCase(), g.id);
      groupBy.set(g.name.toLowerCase(), g.id);
    }
    const existing = await tx.select({ id: items.id, code: items.code, name: items.name }).from(items).where(isNull(items.deletedAt));
    const byCode = new Map(existing.map((i) => [i.code.toUpperCase(), i]));
    const byName = new Map(existing.map((i) => [i.name.toLowerCase(), i]));

    const results: RowResult[] = [];
    for (const row of rows) {
      const r = new RowReader(row.values);
      const name = r.get('name', (v) => text(v, 200), 'Item name is required');
      const code = r.get('code', (v) => text(v, 40)?.toUpperCase() ?? null);
      const label = [code, name].filter(Boolean).join(' · ') || `Row ${row.rowNo}`;

      const dup = (code && byCode.get(code)) || (name && byName.get(name.toLowerCase()));
      if (dup) {
        results.push({ rowNo: row.rowNo, status: 'skipped', label, message: `Already exists as ${dup.code}`, errors: [], ref: { id: dup.id, code: dup.code } });
        continue;
      }

      const unit = (key: string, required?: string) => {
        const raw = r.raw(key);
        if (!raw) {
          if (required) r.fail(key, required);
          return null;
        }
        const id = unitByCode.get(unitKey(raw));
        if (!id) r.fail(key, `Unknown unit "${raw}". Add it under Units & item groups first.`);
        return id ?? null;
      };
      const baseUomId = unit('base_unit', 'Unit is required');
      const purchaseUomId = unit('purchase_unit');
      const factor = r.get('purchase_unit_factor', (v) => decimal(v, 6));
      if (purchaseUomId && purchaseUomId !== baseUomId && !factor) r.fail('purchase_unit_factor', 'How many base units make one purchase unit?');
      const groupRaw = r.raw('group');
      const groupId = groupRaw ? (groupBy.get(groupRaw.toLowerCase()) ?? null) : null;
      if (groupRaw && !groupId) r.fail('group', `Unknown item group "${groupRaw}"`);
      const valuation = r.raw('valuation_method').toLowerCase();
      if (valuation && !['average', 'avg', 'weighted average', 'weighted_average', 'fifo'].includes(valuation)) r.fail('valuation_method', 'Use Average or FIFO');

      const candidate = {
        code: code ?? undefined,
        name: name ?? '',
        description: r.get('description', (v) => text(v, 2000)),
        type: r.get('type', itemType) ?? options.defaultItemType ?? 'raw_material',
        groupId,
        baseUomId: baseUomId ?? '00000000-0000-0000-0000-000000000000',
        purchaseUomId: purchaseUomId && purchaseUomId !== baseUomId ? purchaseUomId : null,
        hsnCode: r.get('hsn_code', (v) => text(v)?.replace(/\s/g, '') ?? null),
        gstRate: r.get('gst_rate', (v) => decimal(v, 2)),
        isNilRatedOrExempt: r.get('nil_rated', (v) => yesNo(v)) ?? false,
        trackBatch: r.get('track_batch', (v) => yesNo(v)) ?? false,
        hasExpiry: r.get('has_expiry', (v) => yesNo(v)) ?? false,
        shelfLifeDays: r.get('shelf_life_days', (v) => integer(v, 1, 36500)),
        trackSerial: r.get('track_serial', (v) => yesNo(v)) ?? false,
        valuationMethod: valuation === 'fifo' ? 'fifo' : 'weighted_average',
        reorderLevel: r.get('reorder_level', (v) => decimal(v, 4)),
        reorderQty: r.get('reorder_qty', (v) => decimal(v, 4)),
        minOrderQty: r.get('min_order_qty', (v) => decimal(v, 4)),
        leadTimeDays: r.get('lead_time_days', (v) => integer(v, 0, 3650)),
        standardCost: r.get('standard_cost', (v) => decimal(v, 4)),
        sellingRate: r.get('selling_rate', (v) => decimal(v, 4)),
        mrp: r.get('mrp', (v) => decimal(v, 2)),
        brand: r.get('brand', (v) => text(v, 80)),
        conversions: purchaseUomId && purchaseUomId !== baseUomId && factor ? [{ uomId: purchaseUomId, factor }] : [],
        barcodes: r.raw('barcode') ? [{ barcode: r.raw('barcode'), isPrimary: true }] : [],
      };
      if (r.errors.length) {
        results.push({ rowNo: row.rowNo, status: 'error', label, errors: r.errors });
        continue;
      }
      const parsed = createItemSchema.safeParse(candidate);
      if (!parsed.success) {
        results.push({ rowNo: row.rowNo, status: 'error', label, errors: zodErrors(parsed.error, ITEM_PATHS) });
        continue;
      }
      try {
        const created = await savepoint(tx, (sp) => this.itemsService.createTx(sp, auth, parsed.data, meta));
        const ref = { id: created.id, code: created.code, name: created.name };
        byCode.set(created.code.toUpperCase(), ref);
        byName.set(created.name.toLowerCase(), ref);
        results.push({ rowNo: row.rowNo, status: 'created', label: `${created.code} · ${created.name}`, errors: [], ref: { id: created.id, code: created.code } });
      } catch (e) {
        results.push({ rowNo: row.rowNo, status: 'error', label, errors: errorsFrom(e, ITEM_PATHS) });
      }
    }
    return results;
  }
}

// ---- Customers & vendors ---------------------------------------------------------

const PARTY_PATHS: Record<string, string> = {
  isCustomer: 'type',
  isVendor: 'type',
  'addresses.0.line1': 'address_line1',
  'addresses.0.line2': 'address_line2',
  'addresses.0.city': 'city',
  'addresses.0.stateCode': 'state',
  'addresses.0.pincode': 'pincode',
  'addresses.0.gstin': 'gstin',
  'contacts.0.name': 'contact_person',
  'contacts.0.email': 'contact_email',
  'contacts.0.phone': 'contact_phone',
  msmeUdyamNo: 'msme_udyam_no',
};

const PARTY_TYPES: Record<string, [boolean, boolean]> = {
  customer: [true, false],
  debtor: [true, false],
  'sundry debtors': [true, false],
  buyer: [true, false],
  vendor: [false, true],
  supplier: [false, true],
  creditor: [false, true],
  'sundry creditors': [false, true],
  both: [true, true],
  'customer and vendor': [true, true],
  'customer & vendor': [true, true],
};

@Injectable()
export class PartiesImporter implements Importer {
  readonly entity = 'parties';
  readonly title = 'Customers & vendors';
  readonly columns: Column[] = [
    { key: 'code', label: 'Code', help: 'Blank = automatic (CUS00001 / VEN00001). Existing codes or GSTINs are skipped.', aliases: ['party_code', 'customer_code', 'vendor_code', 'ledger_code'] },
    { key: 'name', label: 'Name', required: true, example: 'Sharma Polymers', aliases: ['party_name', 'customer_name', 'vendor_name', 'supplier_name', 'ledger_name', 'company_name'] },
    { key: 'type', label: 'Type', required: true, help: 'Customer, Vendor or Both.', example: 'Vendor', aliases: ['party_type', 'customer_vendor'] },
    { key: 'legal_name', label: 'Legal name', help: 'As on the GST certificate, if different.', aliases: ['registered_name', 'trade_name'] },
    { key: 'gstin', label: 'GSTIN', help: '15 characters; the check digit is verified.', example: '36AABCS1234E1ZU', aliases: ['gst_no', 'gst_number', 'gstin_uin', 'gst_in'] },
    { key: 'gst_registration_type', label: 'GST registration', help: 'Regular, Composition, Unregistered, Consumer, Overseas or SEZ. Blank = Regular with a GSTIN, else Unregistered.', aliases: ['registration_type', 'gst_type'] },
    { key: 'pan', label: 'PAN', help: 'Taken from the GSTIN when blank.', aliases: ['pan_no', 'income_tax_number', 'it_pan'] },
    { key: 'email', label: 'Email', aliases: ['email_id', 'e_mail'] },
    { key: 'phone', label: 'Phone', example: '9848012345', aliases: ['mobile', 'phone_no', 'contact_no', 'mobile_no', 'telephone'] },
    { key: 'address_line1', label: 'Address line 1', example: 'Plot 14, IDA Jeedimetla', aliases: ['address', 'address1', 'street'] },
    { key: 'address_line2', label: 'Address line 2', aliases: ['address2', 'area', 'locality'] },
    { key: 'city', label: 'City', example: 'Hyderabad', aliases: ['town', 'district'] },
    { key: 'state', label: 'State', help: 'Name or 2-digit GST code. Blank = from the GSTIN.', example: 'Telangana', aliases: ['state_name', 'state_code'] },
    { key: 'pincode', label: 'PIN code', example: '500055', aliases: ['pin', 'pin_code', 'postal_code', 'zip'] },
    { key: 'contact_person', label: 'Contact person', aliases: ['contact', 'contact_name'] },
    { key: 'contact_phone', label: 'Contact phone', aliases: ['contact_mobile'] },
    { key: 'contact_email', label: 'Contact email' },
    { key: 'credit_days', label: 'Credit days', example: '30', aliases: ['credit_period', 'payment_days'] },
    { key: 'credit_limit', label: 'Credit limit (₹)', aliases: ['credit_limit_rs'] },
    { key: 'payment_terms', label: 'Payment terms' },
    { key: 'msme_udyam_no', label: 'Udyam number', help: 'UDYAM-TS-02-0012345', aliases: ['udyam', 'udyam_no', 'msme_no'] },
    { key: 'msme_category', label: 'MSME category', help: 'Micro, Small or Medium.', aliases: ['msme'] },
    { key: 'notes', label: 'Notes', aliases: ['remarks'] },
  ];

  constructor(private readonly partiesService: PartiesService) {}

  lists() {
    return { States: Object.entries(GST_STATES).map(([c, n]) => `${c}  ${n}`) };
  }

  async run({ tx, auth, meta }: RunContext, rows: ImportRow[]): Promise<RowResult[]> {
    const existing = await tx.select({ id: parties.id, code: parties.code, gstin: parties.gstin, name: parties.name }).from(parties).where(isNull(parties.deletedAt));
    const byCode = new Map(existing.map((p) => [p.code.toUpperCase(), p]));
    const byGstin = new Map(existing.filter((p) => p.gstin).map((p) => [p.gstin!.toUpperCase(), p]));

    const results: RowResult[] = [];
    for (const row of rows) {
      const r = new RowReader(row.values);
      const name = r.get('name', (v) => text(v, 200), 'Name is required');
      const code = r.get('code', (v) => text(v, 30)?.toUpperCase() ?? null);
      const gstin = r.raw('gstin').toUpperCase().replace(/\s/g, '') || null;
      const label = [code, name].filter(Boolean).join(' · ') || `Row ${row.rowNo}`;
      const dup = (code && byCode.get(code)) || (gstin && byGstin.get(gstin));
      if (dup) {
        results.push({ rowNo: row.rowNo, status: 'skipped', label, message: `Already exists as ${dup.code}${gstin && dup.gstin === gstin ? ' (same GSTIN)' : ''}`, errors: [], ref: { id: dup.id, code: dup.code } });
        continue;
      }
      const typeRaw = r.raw('type').toLowerCase();
      const flags = PARTY_TYPES[typeRaw];
      if (!typeRaw) r.fail('type', 'Type is required (Customer, Vendor or Both)');
      else if (!flags) r.fail('type', 'Use Customer, Vendor or Both');
      // Tally writes combined values such as "Unregistered/Consumer": use the first.
      const regRaw = r.raw('gst_registration_type').split('/')[0].trim().toLowerCase().replace(/\s+/g, '_');
      const regMap: Record<string, string> = { regular: 'regular', composition: 'composition', unregistered: 'unregistered', consumer: 'consumer', overseas: 'overseas', export: 'overseas', sez: 'sez', sez_unit: 'sez', sez_developer: 'sez', unknown: 'unregistered' };
      if (regRaw && !regMap[regRaw]) r.fail('gst_registration_type', 'Use Regular, Composition, Unregistered, Consumer, Overseas or SEZ');
      const state = r.get('state', stateCode) ?? (gstin && /^\d{2}/.test(gstin) && gstin.slice(0, 2) in GST_STATES ? gstin.slice(0, 2) : null);
      const line1 = r.get('address_line1', (v) => text(v, 200));
      const city = r.get('city', (v) => text(v, 80));
      if ((line1 || city) && !state) r.fail('state', 'State is needed for the address');
      const contact = r.get('contact_person', (v) => text(v, 100));
      const msme = r.raw('msme_category').toLowerCase();
      if (msme && !['micro', 'small', 'medium'].includes(msme)) r.fail('msme_category', 'Use Micro, Small or Medium');

      const candidate = {
        code: code ?? undefined,
        name: name ?? '',
        legalName: r.get('legal_name', (v) => text(v, 200)),
        isCustomer: flags?.[0] ?? false,
        isVendor: flags?.[1] ?? false,
        gstRegistrationType: regMap[regRaw] ?? (gstin ? 'regular' : 'unregistered'),
        gstin,
        pan: r.raw('pan').toUpperCase() || null,
        msmeUdyamNo: r.raw('msme_udyam_no') || null,
        msmeCategory: msme || null,
        email: r.raw('email') || null,
        phone: r.get('phone', (v) => text(v, 20)),
        creditLimit: r.get('credit_limit', (v) => decimal(v, 2)),
        creditDays: r.get('credit_days', (v) => integer(v, 0, 365)),
        paymentTerms: r.get('payment_terms', (v) => text(v, 200)),
        notes: r.get('notes', (v) => text(v, 2000)),
        addresses:
          line1 || city
            ? [{ type: 'both', line1: line1 ?? '', line2: r.get('address_line2', (v) => text(v, 200)), city: city ?? '', stateCode: state ?? '', pincode: r.raw('pincode') || null, gstin, isDefault: true }]
            : [],
        contacts: contact ? [{ name: contact, phone: r.raw('contact_phone') || null, email: r.raw('contact_email') || null, isPrimary: true }] : [],
      };
      if (r.errors.length) {
        results.push({ rowNo: row.rowNo, status: 'error', label, errors: r.errors });
        continue;
      }
      const parsed = createPartySchema.safeParse(candidate);
      if (!parsed.success) {
        results.push({ rowNo: row.rowNo, status: 'error', label, errors: zodErrors(parsed.error, PARTY_PATHS) });
        continue;
      }
      try {
        const created = await savepoint(tx, (sp) => this.partiesService.createTx(sp, auth, parsed.data, meta));
        const ref = { id: created.id, code: created.code, gstin: created.gstin, name: created.name };
        byCode.set(created.code.toUpperCase(), ref);
        if (created.gstin) byGstin.set(created.gstin.toUpperCase(), ref);
        results.push({ rowNo: row.rowNo, status: 'created', label: `${created.code} · ${created.name}`, errors: [], ref: { id: created.id, code: created.code } });
      } catch (e) {
        results.push({ rowNo: row.rowNo, status: 'error', label, errors: errorsFrom(e, PARTY_PATHS) });
      }
    }
    return results;
  }
}

// ---- Opening stock ---------------------------------------------------------------

const MAX_LINES = 500;

@Injectable()
export class OpeningStockImporter implements Importer {
  readonly entity = 'opening_stock';
  readonly title = 'Opening stock';
  readonly columns: Column[] = [
    { key: 'item_code', label: 'Item code', required: true, help: 'Item code (or exact item name).', example: 'RM-PP-H110', aliases: ['code', 'item', 'sku', 'item_name', 'name'] },
    { key: 'warehouse', label: 'Warehouse', required: true, help: 'Warehouse code, e.g. MAIN.', example: 'MAIN', aliases: ['warehouse_code', 'godown', 'location', 'store'] },
    { key: 'qty', label: 'Quantity', required: true, example: '1250', aliases: ['quantity', 'opening_qty', 'stock', 'closing_qty', 'balance_qty'] },
    { key: 'unit', label: 'Unit', help: 'Blank = the item’s base unit. Another unit needs a conversion on the item.', aliases: ['uom'] },
    { key: 'rate', label: 'Rate (₹)', required: true, help: 'Cost per unit, before GST.', example: '98.50', aliases: ['opening_rate', 'cost', 'valuation_rate', 'unit_cost'] },
    { key: 'batch_no', label: 'Batch no.', help: 'Required for batch-tracked items.', example: 'B2603-17', aliases: ['batch', 'lot', 'lot_no', 'batch_number'] },
    { key: 'mfg_date', label: 'Mfg date', aliases: ['manufacturing_date', 'manufactured_on'] },
    { key: 'expiry_date', label: 'Expiry date', help: 'Blank = mfg date + shelf life.', aliases: ['expiry', 'exp_date', 'best_before'] },
    { key: 'serial_nos', label: 'Serial numbers', help: 'For serialised items: one per unit, separated by commas.', aliases: ['serials', 'serial_no', 'serial_numbers'] },
  ];

  constructor(private readonly stockEntries: StockEntriesService) {}

  lists() {
    return {};
  }

  async run({ tx, auth, meta, options }: RunContext, rows: ImportRow[]): Promise<RowResult[]> {
    const itemRows = await tx
      .select({ id: items.id, code: items.code, name: items.name, baseUomId: items.baseUomId, isStockItem: items.isStockItem, trackBatch: items.trackBatch, trackSerial: items.trackSerial })
      .from(items)
      .where(isNull(items.deletedAt));
    const itemByCode = new Map(itemRows.map((i) => [i.code.toUpperCase(), i]));
    const itemByName = new Map(itemRows.map((i) => [i.name.toLowerCase(), i]));
    const whRows = await tx.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name, isActive: warehouses.isActive }).from(warehouses);
    const whBy = new Map<string, (typeof whRows)[number]>();
    for (const w of whRows) {
      whBy.set(w.code.toLowerCase(), w);
      whBy.set(w.name.toLowerCase(), w);
    }
    const unitRows = await tx.select({ id: uoms.id, code: uoms.code }).from(uoms);
    const unitByCode = new Map(unitRows.map((u) => [u.code.toUpperCase(), u.id]));
    const convs = itemRows.length ? await tx.select().from(itemUomConversions).where(inArray(itemUomConversions.itemId, itemRows.map((i) => i.id))) : [];

    type Line = { rowNo: number; label: string; input: Record<string, unknown> };
    const results = new Map<number, RowResult>();
    const groups = new Map<string, Line[]>();

    for (const row of rows) {
      const r = new RowReader(row.values);
      const ref = r.raw('item_code');
      const item = itemByCode.get(ref.toUpperCase()) ?? itemByName.get(ref.toLowerCase());
      const label = item ? `${item.code} · ${item.name}` : ref || `Row ${row.rowNo}`;
      if (!ref) r.fail('item_code', 'Item code is required');
      else if (!item) r.fail('item_code', `Unknown item "${ref}"`);
      else if (!item.isStockItem) r.fail('item_code', `${item.code} is not a stock item`);
      const whRaw = r.raw('warehouse');
      const wh = whBy.get(whRaw.toLowerCase());
      if (!whRaw) r.fail('warehouse', 'Warehouse is required');
      else if (!wh) r.fail('warehouse', `Unknown warehouse "${whRaw}"`);
      else if (!wh.isActive) r.fail('warehouse', `Warehouse ${wh.code} is inactive`);
      const qty = r.get('qty', (v) => decimal(v, 4), 'Quantity is required');
      if (qty && Decimal.from(qty).isZero()) r.fail('qty', 'Quantity must be more than zero');
      const rate = r.get('rate', (v) => decimal(v, 4), 'Rate is required');
      let uomId = item?.baseUomId ?? null;
      const unitRaw = r.raw('unit');
      if (unitRaw && item) {
        const u = unitByCode.get(unitKey(unitRaw));
        if (!u) r.fail('unit', `Unknown unit "${unitRaw}"`);
        else if (u !== item.baseUomId && !convs.some((c) => c.itemId === item.id && c.uomId === u)) r.fail('unit', `${item.code} has no conversion for ${unitRaw}`);
        else uomId = u;
      }
      const batchNo = r.get('batch_no', (v) => text(v, 40)?.toUpperCase() ?? null);
      if (item?.trackBatch && !batchNo) r.fail('batch_no', `${item.code} needs a batch number`);
      if (item && !item.trackBatch && batchNo) r.fail('batch_no', `${item.code} does not track batches`);
      const serials = r.raw('serial_nos').split(/[\s,;]+/).filter(Boolean);
      if (item?.trackSerial && qty && serials.length !== Number(qty)) r.fail('serial_nos', `Enter ${Number(qty)} serial number(s); found ${serials.length}`);
      const mfgDate = r.get('mfg_date', date);
      const expiryDate = r.get('expiry_date', date);

      if (r.errors.length || !item || !wh) {
        results.set(row.rowNo, { rowNo: row.rowNo, status: 'error', label, errors: r.errors });
        continue;
      }
      const line = { rowNo: row.rowNo, label, input: { itemId: item.id, uomId, qty, rate, batchNo, mfgDate, expiryDate, serialNos: serials.length ? serials : null, remarks: `Imported row ${row.rowNo}` } };
      groups.set(wh.id, [...(groups.get(wh.id) ?? []), line]);
    }

    // One opening stock entry per warehouse (split every 500 lines).
    for (const [warehouseId, lines] of groups) {
      for (let start = 0; start < lines.length; start += MAX_LINES) {
        const chunk = lines.slice(start, start + MAX_LINES);
        try {
          const entry = await savepoint(tx, async (sp) => {
            const parsed = createStockEntrySchema.safeParse({
              purpose: 'opening_stock',
              toWarehouseId: warehouseId,
              docDate: options.postingDate,
              reference: 'Imported',
              lines: chunk.map((l) => l.input),
            });
            if (!parsed.success) throw new BadRequestException({ message: 'Validation failed', errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
            const created = await this.stockEntries.createTx(sp, auth, parsed.data, meta);
            return options.post ? this.stockEntries.submitTx(sp, auth, created.id, created.version, meta) : created;
          });
          chunk.forEach((l) =>
            results.set(l.rowNo, { rowNo: l.rowNo, status: 'created', label: l.label, message: options.post ? `Posted in ${entry.displayNumber}` : 'Added to a draft opening stock entry', errors: [], ref: { id: entry.id, code: entry.number } }),
          );
        } catch (e) {
          const errs = errorsFrom(e, {});
          // Line-level errors come back as "lines.N.field"; route them to their rows.
          const http = e instanceof HttpException ? (e.getResponse() as { errors?: { path: string; message: string }[] }) : null;
          const byLine = new Map<number, CellError[]>();
          for (const x of http?.errors ?? []) {
            const m = x.path.match(/^lines\.(\d+)\.(\w+)/);
            if (m) byLine.set(Number(m[1]), [...(byLine.get(Number(m[1])) ?? []), { column: LINE_COLUMN[m[2]] ?? null, message: x.message }]);
          }
          chunk.forEach((l, i) =>
            results.set(l.rowNo, {
              rowNo: l.rowNo,
              status: 'error',
              label: l.label,
              errors: byLine.get(i) ?? (byLine.size ? [{ column: null, message: 'Not imported: another row in this warehouse has an error' }] : errs),
            }),
          );
        }
      }
    }
    return rows.map((r) => results.get(r.rowNo)!);
  }
}

const LINE_COLUMN: Record<string, string> = { itemId: 'item_code', qty: 'qty', rate: 'rate', uomId: 'unit', batchNo: 'batch_no', expiryDate: 'expiry_date', mfgDate: 'mfg_date', serialNos: 'serial_nos' };
