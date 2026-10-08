import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  deliveryNoteLines,
  deliveryNotes,
  documents,
  ewayBills,
  gstinError,
  items,
  jobWorkChallanLines,
  jobWorkChallans,
  parties,
  PINCODE_REGEX,
  salesInvoiceLines,
  salesInvoices,
  salesOrderLines,
  uoms,
  warehouses,
  type Transaction,
} from '@nextgen/database';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { EInvoiceService } from './einvoice.service';
import type { EwbRequest } from './gsp';
import { GspService } from './gsp.service';

const D = Decimal.from;
const EWB_TYPES = ['sales_invoice', 'delivery_note', 'job_work_challan'] as const;
type EwbDocType = (typeof EWB_TYPES)[number];
const DAY_MS = 24 * 3600_000;

export const EWB_CANCEL_REASONS = { '1': 'Duplicate', '2': 'Order cancelled', '3': 'Data entry mistake', '4': 'Others' } as const;
export const PART_B_REASONS = { '1': 'Due to break down', '2': 'Due to transhipment', '3': 'Others', '4': 'First time' } as const;
export const EXTEND_REASONS = { '1': 'Natural calamity', '2': 'Law and order situation', '4': 'Transhipment', '5': 'Accident', '99': 'Others' } as const;
const MODE_CODE: Record<string, string> = { road: '1', rail: '2', air: '3', ship: '4' };
const VEHICLE_REGEX = /^([A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}|TR[A-Z0-9]{6,12}|BP[A-Z0-9]{6,12}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})$/;

export interface EwbInput {
  distanceKm: number;
  transportMode: 'road' | 'rail' | 'air' | 'ship';
  vehicleType?: 'R' | 'O';
  vehicleNo?: string | null;
  transporterId?: string | null;
  transporterName?: string | null;
  transDocNo?: string | null;
  transDocDate?: string | null;
}

const normVehicle = (v: string | null | undefined) => (v ? v.replace(/[\s-]/g, '').toUpperCase() : null);

/**
 * e-Way bills for goods movement: outward supply (invoice), delivery challan, and material
 * sent to a job worker. Part-A from the document, Part-B (vehicle) now or later, extension
 * near expiry, cancellation within 24 hours, consolidation of several bills on one vehicle.
 */
@Injectable()
export class EwayBillService {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly gsp: GspService,
    private readonly einvoice: EInvoiceService,
  ) {}

  /** What an e-way bill for this document would carry (for the form), plus any existing bills. */
  draft(auth: AuthContext, documentId: string) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.requireDoc(tx, documentId);
      const src = await this.source(tx, doc);
      const bills = await tx.select().from(ewayBills).where(eq(ewayBills.documentId, doc.id)).orderBy(desc(ewayBills.createdAt));
      const s = await this.einvoice.settings(tx, doc.companyId);
      return { request: src.req, defaults: src.defaults, threshold: s.ewayThreshold, required: D(src.req.totalValue).cmp(D(String(s.ewayThreshold))) > 0, bills: bills.map(this.present) };
    });
  }

  async generate(auth: AuthContext, documentId: string, input: EwbInput) {
    const prepared = await this.database.run(auth, async (tx) => {
      const doc = await this.requireDoc(tx, documentId);
      if (doc.status !== 'approved' && doc.status !== 'completed') throw new ConflictException('Generate the e-way bill after the document is approved');
      const [active] = await tx.select({ ewbNo: ewayBills.ewbNo }).from(ewayBills).where(and(eq(ewayBills.documentId, doc.id), eq(ewayBills.status, 'active')));
      if (active) throw new ConflictException(`E-way bill ${active.ewbNo} is already active for this document`);
      const src = await this.source(tx, doc);
      const req: EwbRequest = {
        ...src.req,
        distanceKm: input.distanceKm,
        transportMode: input.transportMode,
        vehicleType: input.vehicleType ?? 'R',
        vehicleNo: normVehicle(input.vehicleNo),
        transporterId: input.transporterId?.toUpperCase() || null,
        transporterName: input.transporterName || null,
        transDocNo: input.transDocNo || null,
        transDocDate: input.transDocDate || null,
      };
      const errors = this.validate(req);
      if (errors.length) throw new UnprocessableEntityException({ message: errors[0].message, errors });
      return { doc, req };
    });
    const { doc, req } = prepared;
    const res = await this.gsp.provider.generateEwb(req.fromGstin, req);
    return this.database.run(auth, async (tx) => {
      await this.einvoice.log(tx, auth, doc, 'ewb', res.ok ? { ok: true, request: req as unknown as Record<string, unknown>, response: res.raw } : { ok: false, code: res.code, message: res.message, request: req as unknown as Record<string, unknown>, response: res.raw });
      if (!res.ok) throw new UnprocessableEntityException(`E-way bill system refused: ${res.message} (${res.code})`);
      const [row] = await tx
        .insert(ewayBills)
        .values({
          tenantId: auth.tenantId,
          companyId: doc.companyId,
          documentId: doc.id,
          ewbNo: res.data.ewbNo,
          ewbDate: new Date(res.data.ewbDate),
          validUntil: res.data.validUntil ? new Date(res.data.validUntil) : null,
          supplyType: req.supplyType,
          subSupplyType: req.subSupplyType,
          docType: req.docType,
          docNo: req.docNo,
          docDate: req.docDate,
          fromGstin: req.fromGstin,
          fromPincode: req.fromPincode,
          fromStateCode: req.fromStateCode,
          toGstin: req.toGstin,
          toPincode: req.toPincode,
          toStateCode: req.toStateCode,
          totalValue: req.totalValue,
          distanceKm: req.distanceKm,
          transportMode: req.transportMode,
          vehicleType: req.vehicleType,
          vehicleNo: req.vehicleNo,
          transporterId: req.transporterId,
          transporterName: req.transporterName,
          transDocNo: req.transDocNo,
          transDocDate: req.transDocDate,
          vehicleHistory: req.vehicleNo ? [{ vehicleNo: req.vehicleNo, fromPlace: '', reason: PART_B_REASONS['4'], at: res.data.ewbDate }] : [],
          payload: req as unknown as Record<string, unknown>,
          createdBy: auth.userId,
        })
        .returning();
      await this.denormalise(tx, doc, row);
      await this.documents.activity(tx, auth, doc.id, 'status', `E-way bill ${row.ewbNo} generated${row.validUntil ? `, valid until ${row.validUntil.toISOString()}` : ' (Part-A; add the vehicle to start validity)'}`);
      return this.present(row);
    });
  }

  async updatePartB(auth: AuthContext, id: string, input: { vehicleNo: string; fromPlace: string; reasonCode: keyof typeof PART_B_REASONS; remark?: string }) {
    const { ewb, doc } = await this.database.run(auth, (tx) => this.loadActive(tx, id));
    const vehicleNo = normVehicle(input.vehicleNo)!;
    if (!VEHICLE_REGEX.test(vehicleNo)) throw new UnprocessableEntityException({ message: 'Enter a valid vehicle number (e.g. TS09AB1234)', errors: [{ path: 'vehicleNo', message: 'Invalid vehicle number' }] });
    if (ewb.validUntil && ewb.validUntil.getTime() < Date.now()) throw new ConflictException('This e-way bill has expired: extend it first');
    const res = await this.gsp.provider.updatePartB(ewb.fromGstin, ewb.ewbNo, { vehicleNo, fromPlace: input.fromPlace, reasonCode: input.reasonCode, distanceKm: ewb.distanceKm, vehicleType: ewb.vehicleType as 'R' | 'O' });
    return this.database.run(auth, async (tx) => {
      await this.einvoice.log(tx, auth, doc, 'ewb_part_b', res.ok ? { ok: true, request: { ewbNo: ewb.ewbNo, ...input }, response: res.raw } : { ok: false, code: res.code, message: res.message, request: { ewbNo: ewb.ewbNo }, response: res.raw });
      if (!res.ok) throw new UnprocessableEntityException(`E-way bill system refused: ${res.message} (${res.code})`);
      const history = [...ewb.vehicleHistory, { vehicleNo, fromPlace: input.fromPlace, reason: PART_B_REASONS[input.reasonCode], at: res.data.updatedAt }];
      // Validity starts with the first Part-B; later vehicle changes keep it.
      const validUntil = ewb.validUntil ?? new Date(res.data.validUntil);
      const [row] = await tx.update(ewayBills).set({ vehicleNo, vehicleHistory: history, validUntil, updatedAt: new Date() }).where(eq(ewayBills.id, ewb.id)).returning();
      await this.denormalise(tx, doc, row);
      await this.documents.activity(tx, auth, doc.id, 'status', `E-way bill ${ewb.ewbNo}: vehicle ${vehicleNo} (${PART_B_REASONS[input.reasonCode]})`);
      return this.present(row);
    });
  }

  async extend(auth: AuthContext, id: string, input: { remainingKm: number; fromPlace: string; reasonCode: keyof typeof EXTEND_REASONS; remark: string }) {
    const { ewb, doc } = await this.database.run(auth, (tx) => this.loadActive(tx, id));
    if (!ewb.validUntil) throw new ConflictException('Add the vehicle (Part-B) first');
    const delta = Date.now() - ewb.validUntil.getTime();
    if (delta < -8 * 3600_000 || delta > 8 * 3600_000) throw new ConflictException('An e-way bill can be extended only between 8 hours before and 8 hours after it expires');
    const res = await this.gsp.provider.extendEwb(ewb.fromGstin, ewb.ewbNo, { remainingKm: input.remainingKm, fromPlace: input.fromPlace, reasonCode: input.reasonCode, vehicleType: ewb.vehicleType as 'R' | 'O' });
    return this.database.run(auth, async (tx) => {
      await this.einvoice.log(tx, auth, doc, 'ewb_extend', res.ok ? { ok: true, request: { ewbNo: ewb.ewbNo, ...input }, response: res.raw } : { ok: false, code: res.code, message: res.message, request: { ewbNo: ewb.ewbNo }, response: res.raw });
      if (!res.ok) throw new UnprocessableEntityException(`E-way bill system refused: ${res.message} (${res.code})`);
      const [row] = await tx.update(ewayBills).set({ validUntil: new Date(res.data.validUntil), extensions: ewb.extensions + 1, updatedAt: new Date() }).where(eq(ewayBills.id, ewb.id)).returning();
      await this.denormalise(tx, doc, row);
      await this.documents.activity(tx, auth, doc.id, 'status', `E-way bill ${ewb.ewbNo} extended (${EXTEND_REASONS[input.reasonCode]}): ${input.remark}`);
      return this.present(row);
    });
  }

  async cancel(auth: AuthContext, id: string, input: { reasonCode: keyof typeof EWB_CANCEL_REASONS; remark: string }) {
    const { ewb, doc } = await this.database.run(auth, (tx) => this.loadActive(tx, id));
    if (Date.now() - ewb.ewbDate.getTime() > DAY_MS) throw new ConflictException('An e-way bill can only be cancelled within 24 hours of generation');
    const res = await this.gsp.provider.cancelEwb(ewb.fromGstin, ewb.ewbNo, input.reasonCode, input.remark);
    return this.database.run(auth, async (tx) => {
      await this.einvoice.log(tx, auth, doc, 'ewb_cancel', res.ok ? { ok: true, request: { ewbNo: ewb.ewbNo, ...input }, response: res.raw } : { ok: false, code: res.code, message: res.message, request: { ewbNo: ewb.ewbNo }, response: res.raw });
      if (!res.ok) throw new UnprocessableEntityException(`E-way bill system refused: ${res.message} (${res.code})`);
      const [row] = await tx
        .update(ewayBills)
        .set({ status: 'cancelled', cancelledAt: new Date(res.data.cancelledAt), cancelReason: `${EWB_CANCEL_REASONS[input.reasonCode]}: ${input.remark}`, updatedAt: new Date() })
        .where(eq(ewayBills.id, ewb.id))
        .returning();
      await this.denormalise(tx, doc, null);
      await this.documents.activity(tx, auth, doc.id, 'status', `E-way bill ${ewb.ewbNo} cancelled (${EWB_CANCEL_REASONS[input.reasonCode]})`);
      return this.present(row);
    });
  }

  /** One consolidated e-way bill for several consignments on the same vehicle. */
  async consolidate(auth: AuthContext, input: { ids: string[]; vehicleNo: string; fromPlace: string }) {
    const vehicleNo = normVehicle(input.vehicleNo)!;
    if (!VEHICLE_REGEX.test(vehicleNo)) throw new UnprocessableEntityException({ message: 'Enter a valid vehicle number', errors: [{ path: 'vehicleNo', message: 'Invalid vehicle number' }] });
    const bills = await this.database.run(auth, (tx) => tx.select().from(ewayBills).where(inArray(ewayBills.id, input.ids)));
    if (bills.length !== input.ids.length || bills.some((b) => b.status !== 'active')) throw new ConflictException('Only active e-way bills can be consolidated');
    if (new Set(bills.map((b) => b.fromGstin)).size > 1) throw new ConflictException('All e-way bills must be from the same GSTIN');
    const res = await this.gsp.provider.consolidate(bills[0].fromGstin, bills.map((b) => b.ewbNo), { vehicleNo, fromPlace: input.fromPlace });
    return this.database.run(auth, async (tx) => {
      await this.einvoice.log(tx, auth, null, 'ewb_consolidate', res.ok ? { ok: true, companyId: bills[0].companyId, request: { ewbNos: bills.map((b) => b.ewbNo), vehicleNo }, response: res.raw } : { ok: false, companyId: bills[0].companyId, code: res.code, message: res.message, request: {}, response: res.raw });
      if (!res.ok) throw new UnprocessableEntityException(`E-way bill system refused: ${res.message} (${res.code})`);
      await tx.update(ewayBills).set({ consolidatedNo: res.data.cewbNo, vehicleNo, updatedAt: new Date() }).where(inArray(ewayBills.id, input.ids));
      return { consolidatedNo: res.data.cewbNo, date: res.data.cewbDate, count: bills.length };
    });
  }

  list(auth: AuthContext, q: { status?: 'active' | 'cancelled' | 'expiring'; from?: string; to?: string; limit: number }) {
    return this.database.run(auth, async (tx) => {
      const soon = new Date(Date.now() + 8 * 3600_000);
      const rows = await tx
        .select({ e: ewayBills, docType: documents.docType, number: documents.number })
        .from(ewayBills)
        .innerJoin(documents, eq(documents.id, ewayBills.documentId))
        .where(
          and(
            q.status === 'expiring' ? and(eq(ewayBills.status, 'active'), lte(ewayBills.validUntil, soon)) : q.status ? eq(ewayBills.status, q.status) : undefined,
            q.from ? gte(ewayBills.ewbDate, new Date(`${q.from}T00:00:00+05:30`)) : undefined,
            q.to ? lte(ewayBills.ewbDate, new Date(`${q.to}T23:59:59+05:30`)) : undefined,
          ),
        )
        .orderBy(desc(ewayBills.ewbDate))
        .limit(q.limit);
      return { items: rows.map((r) => ({ ...this.present(r.e), document: { id: r.e.documentId, docType: r.docType, number: r.number } })) };
    });
  }

  // ---- helpers -----------------------------------------------------------------------

  private present = (e: typeof ewayBills.$inferSelect) => {
    const { tenantId: _t, payload: _p, ...rest } = e;
    const now = Date.now();
    return {
      ...rest,
      expired: e.status === 'active' && !!e.validUntil && e.validUntil.getTime() < now,
      canCancel: e.status === 'active' && now - e.ewbDate.getTime() <= DAY_MS,
      canExtend: e.status === 'active' && !!e.validUntil && Math.abs(now - e.validUntil.getTime()) <= 8 * 3600_000,
    };
  };

  private validate(req: EwbRequest) {
    const errors: { path: string; message: string }[] = [];
    if (!req.fromGstin) errors.push({ path: 'fromGstin', message: 'Add the company / branch GSTIN first' });
    if (!req.fromPincode || !PINCODE_REGEX.test(req.fromPincode)) errors.push({ path: 'fromPincode', message: 'The dispatch PIN code is missing (warehouse or company address)' });
    if (req.toGstin !== 'URP' && !req.toPincode) errors.push({ path: 'toPincode', message: 'The delivery PIN code is missing (ship-to address)' });
    if (req.toPincode && !PINCODE_REGEX.test(req.toPincode)) errors.push({ path: 'toPincode', message: 'The delivery PIN code is invalid' });
    if (!Number.isInteger(req.distanceKm) || req.distanceKm < 1 || req.distanceKm > 4000) errors.push({ path: 'distanceKm', message: 'Distance must be between 1 and 4000 km' });
    if (req.transportMode === 'road') {
      if (!req.vehicleNo && !req.transporterId) errors.push({ path: 'vehicleNo', message: 'Give the vehicle number, or the transporter ID so they can add it' });
      if (req.vehicleNo && !VEHICLE_REGEX.test(req.vehicleNo)) errors.push({ path: 'vehicleNo', message: 'Enter a valid vehicle number (e.g. TS09AB1234)' });
    } else if (!req.transDocNo || !req.transDocDate) errors.push({ path: 'transDocNo', message: 'Rail / air / ship needs the transport document number and date' });
    if (req.transporterId && gstinError(req.transporterId)) errors.push({ path: 'transporterId', message: 'Transporter ID (GSTIN / TRANSIN) is invalid' });
    if (!req.items.length) errors.push({ path: 'items', message: 'No goods on this document (services do not need an e-way bill)' });
    req.items.forEach((it, i) => {
      if (!it.hsnCode) errors.push({ path: `items.${i}.hsnCode`, message: `Line ${i + 1}: HSN code is missing` });
    });
    return errors;
  }

  private async loadActive(tx: Transaction, id: string) {
    const [ewb] = await tx.select().from(ewayBills).where(eq(ewayBills.id, id));
    if (!ewb) throw new NotFoundException('E-way bill not found');
    if (ewb.status !== 'active') throw new ConflictException('This e-way bill is cancelled');
    const [doc] = await tx.select().from(documents).where(eq(documents.id, ewb.documentId));
    return { ewb, doc };
  }

  private async requireDoc(tx: Transaction, id: string) {
    const [doc] = await tx.select().from(documents).where(and(eq(documents.id, id), inArray(documents.docType, [...EWB_TYPES])));
    if (!doc) throw new NotFoundException('Document not found (e-way bills are made from invoices, delivery notes and job-work challans)');
    return doc as DocumentRow & { docType: EwbDocType };
  }

  /** Copies the active bill's number onto the document header. */
  private async denormalise(tx: Transaction, doc: DocumentRow, row: typeof ewayBills.$inferSelect | null) {
    if (doc.docType === 'sales_invoice') await tx.update(salesInvoices).set({ ewayBillNo: row?.ewbNo ?? null, ewayBillDate: row?.ewbDate ?? null, ewayValidUntil: row?.validUntil ?? null }).where(eq(salesInvoices.id, doc.id));
    if (doc.docType === 'job_work_challan') await tx.update(jobWorkChallans).set({ ewayBillNo: row?.ewbNo ?? null }).where(eq(jobWorkChallans.id, doc.id));
  }

  private async fromPlace(tx: Transaction, doc: DocumentRow, warehouseId: string | null) {
    const seller = await this.einvoice.seller(tx, doc.companyId, doc.branchId);
    const [wh] = warehouseId ? await tx.select({ address: warehouses.address }).from(warehouses).where(eq(warehouses.id, warehouseId)) : [];
    const pin = wh?.address?.pincode || seller.address.pincode || null;
    return { gstin: seller.gstin ?? '', pincode: pin, stateCode: seller.stateCode, place: wh?.address?.city || seller.address.city || '' };
  }

  private async source(tx: Transaction, doc: DocumentRow & { docType: EwbDocType }): Promise<{ req: EwbRequest; defaults: Partial<EwbInput> }> {
    const base = { distanceKm: 0, transportMode: 'road', vehicleType: 'R' as const, vehicleNo: null, transporterId: null, transporterName: null, transDocNo: null, transDocDate: null };
    if (doc.docType === 'sales_invoice') {
      const [inv] = await tx.select().from(salesInvoices).where(eq(salesInvoices.id, doc.id));
      const lines = await tx
        .select({ hsnCode: salesInvoiceLines.hsnCode, qty: salesInvoiceLines.qty, uqc: uoms.uqc, taxableValue: salesInvoiceLines.taxableValue, gstRate: salesInvoiceLines.gstRate })
        .from(salesInvoiceLines)
        .innerJoin(items, eq(items.id, salesInvoiceLines.itemId))
        .innerJoin(uoms, eq(uoms.id, salesInvoiceLines.uomId))
        .where(and(eq(salesInvoiceLines.invoiceId, doc.id), sql`${items.type} <> 'service'`));
      // Goods left from the invoice's warehouse, or from the delivery note's.
      const [dl] = await tx
        .select({ warehouseId: deliveryNotes.warehouseId })
        .from(salesInvoiceLines)
        .innerJoin(deliveryNoteLines, eq(deliveryNoteLines.id, salesInvoiceLines.dlvLineId))
        .innerJoin(deliveryNotes, eq(deliveryNotes.id, deliveryNoteLines.deliveryId))
        .where(eq(salesInvoiceLines.invoiceId, doc.id))
        .limit(1);
      const from = await this.fromPlace(tx, doc, inv.warehouseId ?? dl?.warehouseId ?? null);
      const exportSale = inv.taxKind === 'export';
      const ship = inv.shippingAddress.pincode ? inv.shippingAddress : inv.billingAddress;
      return {
        req: {
          ...base,
          supplyType: 'O',
          subSupplyType: exportSale ? '3' : '1',
          docType: inv.taxKind === 'bill_of_supply' ? 'BIL' : 'INV',
          docNo: doc.number ?? '',
          docDate: doc.docDate,
          fromGstin: from.gstin,
          fromPincode: from.pincode,
          fromStateCode: from.stateCode,
          toGstin: exportSale || !inv.customerGstin ? 'URP' : inv.customerGstin,
          toPincode: exportSale ? (ship.pincode ?? null) : (ship.pincode ?? null),
          toStateCode: exportSale ? '96' : (inv.placeOfSupply ?? inv.customerStateCode),
          totalValue: inv.grandTotal,
          items: lines.map((l) => ({ ...l, hsnCode: l.hsnCode ?? '' })),
          irn: inv.irnStatus === 'generated' ? inv.irn : null,
        },
        defaults: { vehicleNo: inv.vehicleNo, transporterName: inv.transporter, transDocNo: inv.lrNo },
      };
    }
    if (doc.docType === 'delivery_note') {
      const [dn] = await tx.select().from(deliveryNotes).where(eq(deliveryNotes.id, doc.id));
      const [cust] = await tx.select({ gstin: parties.gstin, stateCode: parties.stateCode }).from(parties).where(eq(parties.id, dn.customerId));
      const lines = await tx
        .select({ hsnCode: salesOrderLines.hsnCode, qty: deliveryNoteLines.qty, uqc: uoms.uqc, soQty: salesOrderLines.qty, soTaxable: salesOrderLines.taxableValue, gstRate: salesOrderLines.gstRate })
        .from(deliveryNoteLines)
        .innerJoin(salesOrderLines, eq(salesOrderLines.id, deliveryNoteLines.soLineId))
        .innerJoin(uoms, eq(uoms.id, deliveryNoteLines.uomId))
        .where(eq(deliveryNoteLines.deliveryId, doc.id));
      const its = lines.map((l) => ({ hsnCode: l.hsnCode ?? '', qty: l.qty, uqc: l.uqc, gstRate: l.gstRate, taxableValue: D(l.soTaxable).mul(D(l.qty)).div(D(l.soQty)).toFixed(2) }));
      const value = its.reduce((s, l) => s.add(D(l.taxableValue)).add(D(l.taxableValue).mul(D(l.gstRate)).div(D('100'))), D('0'));
      const from = await this.fromPlace(tx, doc, dn.warehouseId);
      return {
        req: {
          ...base,
          supplyType: 'O',
          subSupplyType: '8',
          docType: 'CHL',
          docNo: doc.number ?? '',
          docDate: doc.docDate,
          fromGstin: from.gstin,
          fromPincode: from.pincode,
          fromStateCode: from.stateCode,
          toGstin: cust.gstin ?? 'URP',
          toPincode: dn.shippingAddress.pincode ?? null,
          toStateCode: dn.shippingAddress.stateCode ?? cust.stateCode,
          totalValue: value.toFixed(2),
          items: its,
        },
        defaults: { vehicleNo: dn.vehicleNo, transporterName: dn.transporter, transporterId: dn.transporterGstin, distanceKm: dn.distanceKm ?? undefined, transDocNo: dn.lrNo, transDocDate: dn.lrDate },
      };
    }
    const [jw] = await tx.select().from(jobWorkChallans).where(eq(jobWorkChallans.id, doc.id));
    const lines = await tx
      .select({ hsnCode: jobWorkChallanLines.hsnCode, qty: jobWorkChallanLines.qty, uqc: uoms.uqc, taxableValue: jobWorkChallanLines.value, gstRate: jobWorkChallanLines.gstRate })
      .from(jobWorkChallanLines)
      .innerJoin(uoms, eq(uoms.id, jobWorkChallanLines.uomId))
      .where(eq(jobWorkChallanLines.challanId, doc.id));
    const from = await this.fromPlace(tx, doc, jw.warehouseId);
    return {
      req: {
        ...base,
        supplyType: 'O',
        subSupplyType: '4',
        docType: 'CHL',
        docNo: doc.number ?? '',
        docDate: doc.docDate,
        fromGstin: from.gstin,
        fromPincode: from.pincode,
        fromStateCode: from.stateCode,
        toGstin: jw.jobWorkerGstin ?? 'URP',
        toPincode: jw.jobWorkerAddress.pincode ?? null,
        toStateCode: jw.jobWorkerStateCode,
        totalValue: jw.totalValue,
        items: lines.map((l) => ({ ...l, hsnCode: l.hsnCode ?? '' })),
      },
      defaults: { vehicleNo: jw.vehicleNo, transporterName: jw.transporter },
    };
  }
}

{ MODE_CODE };
