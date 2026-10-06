import { BadRequestException } from '@nestjs/common';
import { GST_UQC } from '@nextgen/database';
import { XMLParser } from 'fast-xml-parser';
import { decodeText } from './file-parser';
import type { ImportRow } from './importers';
import { date as parseDate, toCode, unitKey, ValueError } from './values';

/**
 * Reads a Tally (ERP 9 / TallyPrime) masters export:
 *   Gateway of Tally → Export → Masters → XML (data interchange).
 * Units, stock groups, godowns, stock items (with HSN/GST, batches, opening stock)
 * and Sundry Debtor / Creditor ledgers become rows for the regular importers.
 */

export interface TallyUnit {
  name: string;
  code: string;
  decimals: number;
  uqc: string;
}

export interface TallyData {
  units: TallyUnit[];
  groups: { name: string; parent: string | null }[];
  godowns: string[];
  items: ImportRow[];
  parties: ImportRow[];
  opening: ImportRow[];
  /** Counts for the summary ("312 other ledgers ignored"). */
  skipped: { ledgers: number; compoundUnits: number };
  warnings: string[];
}

const LIST = /\.LIST$/;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => LIST.test(name) || ['TALLYMESSAGE', 'NAME', 'ADDRESS', 'MAILINGNAME', 'STOCKITEM', 'LEDGER', 'UNIT', 'STOCKGROUP', 'GODOWN', 'GROUP'].includes(name),
});

type Node = Record<string, unknown>;

/** Text of a tag that may be a string, an object with #text, or an array. */
function str(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return str(v[0]);
  if (typeof v === 'object') return str((v as Node)['#text']);
  // Tally prefixes "special" values with &#4; (e.g. "&#4; Applicable").
  return String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
}

const arr = (v: unknown): Node[] => (Array.isArray(v) ? (v as Node[]) : v ? [v as Node] : []);
const name = (n: Node) => str(n['@_NAME']) || str(arr(arr(n['LANGUAGENAME.LIST'])[0]?.['NAME.LIST'])[0]?.NAME);

/** " 100.500 Kgs" → "100.5"; "-12 Nos" → "-12". */
function qtyOf(v: string): string | null {
  const m = v.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? m[0] : null;
}

/** "50.00/Kgs" → "50.00". */
function rateOf(v: string): string | null {
  const m = v.replace(/,/g, '').split('/')[0].match(/-?\d+(\.\d+)?/);
  return m ? m[0] : null;
}

function tallyDate(n: unknown): string | null {
  const attr = typeof n === 'object' && n ? str((n as Node)['@_P']) : '';
  const raw = attr || str(n);
  if (!raw) return null;
  try {
    return parseDate(raw);
  } catch (e) {
    if (e instanceof ValueError) return null;
    throw e;
  }
}

const abs = (s: string) => s.replace(/^-/, '');

export function parseTally(buffer: Buffer): TallyData {
  let xml = decodeText(buffer);
  if (!/<ENVELOPE/i.test(xml.slice(0, 2000))) throw new BadRequestException('This is not a Tally XML export. In Tally: Export → Masters, format XML.');
  // Tally writes control characters as numeric entities (&#4;) that XML parsers reject.
  xml = xml.replace(/&#(\d+);/g, (m, d) => (Number(d) < 32 && ![9, 10, 13].includes(Number(d)) ? '' : m));
  let doc: Node;
  try {
    doc = parser.parse(xml) as Node;
  } catch {
    throw new BadRequestException('The Tally XML file could not be read. Export it again and retry.');
  }
  const body = (doc.ENVELOPE as Node)?.BODY as Node | undefined;
  // Export → Masters writes IMPORTDATA/REQUESTDATA; exports over Tally's HTTP API use DATA.
  const container = ((body?.IMPORTDATA as Node)?.REQUESTDATA ?? body?.DATA) as Node | undefined;
  const messages = arr(container?.TALLYMESSAGE);
  if (!messages.length) throw new BadRequestException('No masters found in this Tally file');

  const pick = (tag: string) => messages.flatMap((m) => arr(m[tag]));
  const out: TallyData = { units: [], groups: [], godowns: [], items: [], parties: [], opening: [], skipped: { ledgers: 0, compoundUnits: 0 }, warnings: [] };

  // ---- units ----
  for (const u of pick('UNIT')) {
    const n = name(u);
    if (!n) continue;
    if (str(u.ISSIMPLEUNIT).toLowerCase() === 'no') {
      out.skipped.compoundUnits++;
      continue;
    }
    const uqcRaw = str(u.GSTREPUOM).split('-')[0].toUpperCase();
    out.units.push({ name: n, code: unitKey(n).slice(0, 10), decimals: Math.min(6, Number(str(u.DECIMALPLACES)) || 0), uqc: uqcRaw in GST_UQC ? uqcRaw : 'OTH' });
  }

  // ---- stock groups (GST can be set on a group and inherited by its items) ----
  const groupGst = new Map<string, { hsn: string | null; rate: string | null; parent: string | null }>();
  for (const g of pick('STOCKGROUP')) {
    const n = name(g);
    if (!n) continue;
    const parent = str(g.PARENT) || null;
    out.groups.push({ name: n, parent });
    groupGst.set(n, { ...gstOf(g), parent });
  }
  const inheritedGst = (group: string | null) => {
    let cursor = group;
    for (let depth = 0; cursor && depth < 10; depth++) {
      const g = groupGst.get(cursor);
      if (!g) break;
      if (g.rate || g.hsn) return g;
      cursor = g.parent;
    }
    return null;
  };

  // ---- godowns ----
  out.godowns = pick('GODOWN')
    .map(name)
    .filter(Boolean);

  // ---- stock items ----
  let row = 0;
  for (const it of pick('STOCKITEM')) {
    const n = name(it);
    if (!n) continue;
    row++;
    const names = arr(arr(it['LANGUAGENAME.LIST'])[0]?.['NAME.LIST'])[0]?.NAME as unknown[] | undefined;
    const alias = names && names.length > 1 ? str(names[1]) : '';
    const parent = str(it.PARENT) || null;
    const own = gstOf(it);
    const inherited = !own.rate && !own.hsn ? inheritedGst(parent) : null;
    const base = str(it.BASEUNITS);
    const alt = str(it.ADDITIONALUNITS);
    const denominator = Number(qtyOf(str(it.DENOMINATOR)) ?? 0);
    const conversion = Number(qtyOf(str(it.CONVERSION)) ?? 0);
    const batchWise = str(it.ISBATCHWISEON).toLowerCase() === 'yes';
    const perishable = str(it.ISPERISHABLEON).toLowerCase() === 'yes';
    const values: Record<string, string> = {
      code: /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/.test(alias) ? alias : '',
      name: n,
      group: parent ?? '',
      base_unit: base,
      hsn_code: own.hsn ?? inherited?.hsn ?? '',
      gst_rate: own.rate ?? inherited?.rate ?? '',
      nil_rated: own.exempt ? 'yes' : 'no',
      track_batch: batchWise ? 'yes' : 'no',
      // Perishable items need batch tracking here (expiry is kept per batch).
      has_expiry: batchWise && perishable ? 'yes' : 'no',
      description: str(it.DESCRIPTION) || str(it.NARRATION),
      standard_cost: '',
      reorder_level: qtyOf(str(it.REORDERBASE)) ?? '',
      min_order_qty: qtyOf(str(it.MINIMUMORDERBASE)) ?? '',
      mrp: '',
    };
    if (alt && denominator > 0 && conversion > 0) {
      values.purchase_unit = alt;
      // Tally: "<denominator> base units = <conversion> alternate units".
      values.purchase_unit_factor = String(Number((denominator / conversion).toFixed(6)));
    }
    if (perishable && !batchWise) out.warnings.push(`${n}: perishable in Tally but not batch-wise, so expiry is not tracked`);
    out.items.push({ rowNo: row, values });

    // Opening stock: per godown / batch allocation, else the item total in the main store.
    const allocations = arr(it['BATCHALLOCATIONS.LIST']).filter((b) => Number(qtyOf(str(b.OPENINGBALANCE)) ?? 0) !== 0);
    const pushOpening = (godown: string, qtyRaw: string, rateRaw: string, valueRaw: string, batch?: Node) => {
      const qty = qtyOf(qtyRaw);
      if (!qty || Number(qty) === 0) return;
      let rate = rateOf(rateRaw);
      const value = qtyOf(valueRaw);
      if ((!rate || Number(rate) === 0) && value) rate = String(Math.abs(Number(value)) / Math.abs(Number(qty)));
      if (Number(qty) < 0) {
        out.warnings.push(`${n}: negative opening stock (${qty}) in ${godown || 'main location'} was not imported`);
        return;
      }
      const batchName = batch ? str(batch.BATCHNAME) : '';
      out.opening.push({
        rowNo: out.opening.length + 1,
        values: {
          item_code: n,
          warehouse: godown,
          qty: abs(qty),
          rate: rate ? abs(rate) : '0',
          batch_no: batchWise && batchName && batchName.toLowerCase() !== 'primary batch' ? batchName : batchWise ? 'OPENING' : '',
          mfg_date: batch ? (tallyDate(batch.MFDON) ?? '') : '',
          expiry_date: batch ? (tallyDate(batch.EXPIRYPERIOD) ?? '') : '',
        },
      });
    };
    if (allocations.length) {
      for (const b of allocations) pushOpening(str(b.GODOWNNAME), str(b.OPENINGBALANCE), str(b.OPENINGRATE), str(b.OPENINGVALUE), b);
    } else {
      pushOpening('', str(it.OPENINGBALANCE), str(it.OPENINGRATE), str(it.OPENINGVALUE));
    }
  }

  // ---- ledgers: only customers and vendors (accounts come in Phase 4) ----
  const accountGroups = new Map(pick('GROUP').map((g) => [name(g), str(g.PARENT) || null]));
  const partyKind = (group: string) => {
    let cursor: string | null = group;
    for (let depth = 0; cursor && depth < 10; depth++) {
      const lower = cursor.toLowerCase();
      if (lower === 'sundry debtors') return 'Customer';
      if (lower === 'sundry creditors') return 'Vendor';
      cursor = accountGroups.get(cursor) ?? null;
    }
    return null;
  };
  let partyRow = 0;
  for (const l of pick('LEDGER')) {
    const n = name(l);
    const kind = partyKind(str(l.PARENT));
    if (!n || !kind) {
      out.skipped.ledgers++;
      continue;
    }
    partyRow++;
    // TallyPrime 3+ keeps GST and address details in dated sub-lists; older exports use flat tags.
    const gstReg = arr(l['LEDGSTREGDETAILS.LIST']).at(-1) ?? {};
    const mailing = arr(l['LEDMAILINGDETAILS.LIST']).at(-1) ?? {};
    const address = arr((mailing as Node)['ADDRESS.LIST'] ?? l['ADDRESS.LIST'])
      .flatMap((a) => arr(a.ADDRESS as unknown as Node[]).map(str))
      .filter(Boolean);
    const gstin = (str((gstReg as Node).GSTIN) || str(l.PARTYGSTIN)).toUpperCase();
    const regType = str((gstReg as Node).GSTREGISTRATIONTYPE) || str(l.GSTREGISTRATIONTYPE);
    const state = str((mailing as Node).STATE) || str(l.LEDSTATENAME) || str(l.STATENAME);
    const country = str((mailing as Node).COUNTRY) || str(l.COUNTRYNAME) || str(l.COUNTRYOFRESIDENCE);
    const overseas = country && country.toLowerCase() !== 'india';
    out.parties.push({
      rowNo: partyRow,
      values: {
        name: n,
        type: kind,
        legal_name: str(arr((mailing as Node)['MAILINGNAME.LIST'] ?? l['MAILINGNAME.LIST'])[0]?.MAILINGNAME) !== n ? str(arr((mailing as Node)['MAILINGNAME.LIST'] ?? l['MAILINGNAME.LIST'])[0]?.MAILINGNAME) : '',
        gstin,
        gst_registration_type: overseas ? 'overseas' : regType.toLowerCase() === 'unknown' ? '' : regType,
        pan: str(l.INCOMETAXNUMBER),
        email: str(l.EMAIL),
        phone: str(l.LEDGERMOBILE) || str(l.LEDGERPHONE),
        address_line1: address.slice(0, 2).join(', ').slice(0, 200),
        address_line2: address.slice(2).join(', ').slice(0, 200),
        city: '',
        state: overseas ? '' : state,
        pincode: str((mailing as Node).PINCODE) || str(l.PINCODE),
        contact_person: str(l.LEDGERCONTACT),
        credit_days: qtyOf(str(l.BILLCREDITPERIOD)) ?? '',
        notes: str(l.NARRATION) || str(l.DESCRIPTION),
      },
    });
    // Tally has no separate city field: use the last address line as the city.
    const values = out.parties.at(-1)!.values;
    if (values.address_line1) values.city = (address.at(-1) ?? '').replace(/[-,]?\s*\d{6}$/, '').slice(0, 80) || values.state;
    else values.state = '';
  }
  return out;
}

/** HSN + IGST rate from the most recent GST details of a stock item or group. */
function gstOf(n: Node): { hsn: string | null; rate: string | null; exempt: boolean } {
  const details = arr(n['GSTDETAILS.LIST']).sort((a, b) => str(a.APPLICABLEFROM).localeCompare(str(b.APPLICABLEFROM)));
  const latest = details.at(-1);
  const hsnDetails = arr(n['HSNDETAILS.LIST']).sort((a, b) => str(a.APPLICABLEFROM).localeCompare(str(b.APPLICABLEFROM))).at(-1);
  const hsn = (str(hsnDetails?.HSNCODE) || str(latest?.HSNCODE)).replace(/\s/g, '') || null;
  const taxability = str(latest?.TAXABILITY).toLowerCase();
  let rate: string | null = null;
  for (const s of arr(latest?.['STATEWISEDETAILS.LIST'])) {
    for (const r of arr(s['RATEDETAILS.LIST'])) {
      const head = str(r.GSTRATEDUTYHEAD).toLowerCase();
      if (head === 'igst' || head === 'integrated tax') rate = qtyOf(str(r.GSTRATE));
    }
  }
  const exempt = taxability === 'exempt' || taxability === 'nil rated';
  return { hsn, rate: exempt ? '0' : rate, exempt };
}

/** Code for a new master from a Tally name, unique within `taken`. */
export function uniqueCode(name: string, max: number, taken: Set<string>) {
  const base = toCode(name, max) || 'X';
  let code = base;
  for (let i = 2; taken.has(code); i++) code = `${base.slice(0, max - String(i).length - 1)}-${i}`;
  taken.add(code);
  return code;
}
