import { createHash, createSign, generateKeyPairSync, randomInt, type KeyObject } from 'node:crypto';
import { fiscalYearOf } from '../../common/fiscal-year';
import { qrClaims } from './einvoice-payload';

/**
 * GST Suvidha Provider (GSP) gateway to the Invoice Registration Portal (IRP) and the
 * e-Way Bill system. "sandbox" mimics the NIC APIs locally (same IRN formula, signed JWT QR,
 * EWB validity rules) so the whole flow works and is testable without credentials; a
 * production adapter (ClearTax, Masters India, IRIS…) implements the same interface.
 */

export type GspResult<T> = { ok: true; data: T; raw: Record<string, unknown> } | { ok: false; code: string; message: string; transient: boolean; raw: Record<string, unknown> };

export interface IrnData {
  irn: string;
  ackNo: string;
  /** ISO timestamp */
  ackDate: string;
  signedInvoice: string;
  signedQr: string;
}

export interface EwbData {
  ewbNo: string;
  ewbDate: string;
  validUntil: string | null;
}

export interface EwbRequest {
  supplyType: 'O' | 'I';
  subSupplyType: string;
  docType: string;
  docNo: string;
  docDate: string;
  fromGstin: string;
  fromPincode: string | null;
  fromStateCode: string | null;
  toGstin: string;
  toPincode: string | null;
  toStateCode: string | null;
  totalValue: string;
  distanceKm: number;
  transportMode: string;
  vehicleType: 'R' | 'O';
  vehicleNo: string | null;
  transporterId: string | null;
  transporterName: string | null;
  transDocNo: string | null;
  transDocDate: string | null;
  items: { hsnCode: string; qty: string; uqc: string; taxableValue: string; gstRate: string }[];
  irn?: string | null;
}

export interface GspProvider {
  readonly name: string;
  generateIrn(gstin: string, payload: Record<string, unknown>, docDate: string): Promise<GspResult<IrnData>>;
  cancelIrn(gstin: string, irn: string, reasonCode: string, remark: string): Promise<GspResult<{ cancelledAt: string }>>;
  generateEwb(gstin: string, req: EwbRequest): Promise<GspResult<EwbData>>;
  updatePartB(gstin: string, ewbNo: string, input: { vehicleNo: string; fromPlace: string; reasonCode: string; distanceKm: number; vehicleType: 'R' | 'O' }): Promise<GspResult<{ updatedAt: string; validUntil: string }>>;
  extendEwb(gstin: string, ewbNo: string, input: { remainingKm: number; fromPlace: string; reasonCode: string; vehicleType: 'R' | 'O' }): Promise<GspResult<{ validUntil: string }>>;
  cancelEwb(gstin: string, ewbNo: string, reasonCode: string, remark: string): Promise<GspResult<{ cancelledAt: string }>>;
  consolidate(gstin: string, ewbNos: string[], input: { vehicleNo: string; fromPlace: string }): Promise<GspResult<{ cewbNo: string; cewbDate: string }>>;
}

// ---- Pure rules (shared by the sandbox and the service) -------------------------------

/** IRN = SHA-256 of supplier GSTIN + financial year + document type + document number (NIC). */
export function irnFor(gstin: string, docDate: string, docType: string, docNo: string) {
  return createHash('sha256').update(`${gstin}${fiscalYearOf(docDate).label4}${docType}${docNo}`.toUpperCase()).digest('hex');
}

const IST_MS = 5.5 * 3600_000;
/** e-Way bill validity: 1 day per 200 km (20 km for over-dimensional cargo); each day ends at midnight IST. */
export function ewbValidUntil(from: Date, distanceKm: number, vehicleType: 'R' | 'O' = 'R') {
  const days = Math.max(1, Math.ceil(distanceKm / (vehicleType === 'O' ? 20 : 200)));
  const ist = new Date(from.getTime() + IST_MS);
  const endIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + days, 23, 59, 59);
  return new Date(endIst - IST_MS);
}

/** "yyyy-MM-dd HH:mm:ss" in IST, as NIC returns timestamps. */
export function nicTimestamp(d: Date) {
  return new Date(d.getTime() + IST_MS).toISOString().replace('T', ' ').slice(0, 19);
}

// ---- Sandbox ------------------------------------------------------------------------

const b64u = (v: string | Buffer) => Buffer.from(v).toString('base64url');

export class SandboxGsp implements GspProvider {
  readonly name = 'sandbox';
  private key: KeyObject | null = null;

  /** RS256 JWT, as the IRP signs invoices and QR codes (sandbox key, generated per process). */
  private sign(claims: Record<string, unknown>) {
    if (!this.key) this.key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const head = b64u(JSON.stringify({ alg: 'RS256', kid: 'NEXTGEN-SANDBOX', typ: 'JWT' }));
    const body = b64u(JSON.stringify({ data: JSON.stringify(claims), iss: 'NIC Sandbox (NextGen ERP)' }));
    const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(this.key);
    return `${head}.${body}.${b64u(sig)}`;
  }

  private ok<T>(data: T): GspResult<T> {
    return { ok: true, data, raw: { Status: 1, Data: data as unknown as Record<string, unknown> } };
  }

  private fail(code: string, message: string): GspResult<never> {
    return { ok: false, code, message, transient: false, raw: { Status: 0, ErrorDetails: [{ ErrorCode: code, ErrorMessage: message }] } };
  }

  async generateIrn(gstin: string, payload: Record<string, unknown>, docDate: string): Promise<GspResult<IrnData>> {
    const seller = payload.SellerDtls as { Gstin: string };
    if (seller.Gstin !== gstin) return this.fail('2155', 'Seller GSTIN does not match the authenticated GSTIN');
    const doc = payload.DocDtls as { Typ: string; No: string };
    const irn = irnFor(gstin, docDate, doc.Typ, doc.No);
    const now = new Date();
    const ackNo = `1${BigInt(`0x${irn.slice(0, 15)}`).toString().padStart(14, '0').slice(-14)}`;
    const ackDt = nicTimestamp(now);
    return this.ok({
      irn,
      ackNo,
      ackDate: now.toISOString(),
      signedInvoice: this.sign({ ...payload, Irn: irn, AckNo: ackNo, AckDt: ackDt }),
      signedQr: this.sign(qrClaims(payload, irn, ackDt)),
    });
  }

  async cancelIrn(_gstin: string, irn: string, reasonCode: string, remark: string) {
    if (!['1', '2', '3', '4'].includes(reasonCode)) return this.fail('9999', 'Invalid cancel reason');
    if (!remark.trim()) return this.fail('9999', 'Cancel remark is required');
    return { ...this.ok({ cancelledAt: new Date().toISOString() }), raw: { Irn: irn, CancelDate: nicTimestamp(new Date()) } };
  }

  async generateEwb(_gstin: string, req: EwbRequest): Promise<GspResult<EwbData>> {
    const now = new Date();
    const hasPartB = !!req.vehicleNo || (req.transportMode !== 'road' && !!req.transDocNo);
    return this.ok({
      ewbNo: `${randomInt(1, 10)}${String(randomInt(0, 1e9)).padStart(9, '0')}${String(randomInt(0, 100)).padStart(2, '0')}`,
      ewbDate: now.toISOString(),
      // Part-A only (transporter to add the vehicle): validity starts with Part-B.
      validUntil: hasPartB ? ewbValidUntil(now, req.distanceKm, req.vehicleType).toISOString() : null,
    });
  }

  async updatePartB(_gstin: string, _ewbNo: string, input: { vehicleNo: string; fromPlace: string; reasonCode: string; distanceKm: number; vehicleType: 'R' | 'O' }) {
    const now = new Date();
    return this.ok({ updatedAt: now.toISOString(), validUntil: ewbValidUntil(now, input.distanceKm, input.vehicleType).toISOString() });
  }

  async extendEwb(_gstin: string, _ewbNo: string, input: { remainingKm: number; fromPlace: string; reasonCode: string; vehicleType: 'R' | 'O' }) {
    return this.ok({ validUntil: ewbValidUntil(new Date(), input.remainingKm, input.vehicleType).toISOString() });
  }

  async cancelEwb(_gstin: string, _ewbNo: string, reasonCode: string, remark: string) {
    if (!['1', '2', '3', '4'].includes(reasonCode)) return this.fail('312', 'Invalid cancel reason');
    if (!remark.trim()) return this.fail('313', 'Cancel remark is required');
    return this.ok({ cancelledAt: new Date().toISOString() });
  }

  async consolidate(_gstin: string, ewbNos: string[], _input: { vehicleNo: string; fromPlace: string }) {
    if (ewbNos.length < 2) return this.fail('604', 'A consolidated e-way bill needs at least two e-way bills');
    return this.ok({ cewbNo: `${randomInt(1, 10)}${String(randomInt(0, 1e9)).padStart(9, '0')}`, cewbDate: new Date().toISOString() });
  }
}
