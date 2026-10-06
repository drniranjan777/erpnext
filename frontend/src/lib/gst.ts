export interface GstSettings {
  einvoice: boolean;
  autoIrn: boolean;
  ewayThreshold: number;
}

export interface EInvoiceStatus {
  enabled: boolean;
  applicable: boolean;
  reason: string | null;
  irn: string | null;
  ackNo: string | null;
  ackDate: string | null;
  irnStatus: "pending" | "generated" | "failed" | "cancelled" | null;
  irnError: string | null;
  irnCancelledAt: string | null;
  qrDataUri: string | null;
  cancellableUntil: string | null;
  log: { id: string; action: string; ok: boolean; errorCode: string | null; errorMessage: string | null; createdAt: string }[];
}

export interface EwayBill {
  id: string;
  documentId: string;
  ewbNo: string;
  ewbDate: string;
  validUntil: string | null;
  status: "active" | "cancelled";
  supplyType: string;
  subSupplyType: string;
  docType: string;
  docNo: string;
  fromGstin: string;
  toGstin: string;
  fromPincode: string | null;
  toPincode: string | null;
  totalValue: string;
  distanceKm: number;
  transportMode: string;
  vehicleType: string;
  vehicleNo: string | null;
  transporterId: string | null;
  transporterName: string | null;
  vehicleHistory: { vehicleNo: string; fromPlace: string; reason: string; at: string }[];
  extensions: number;
  consolidatedNo: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  expired: boolean;
  canCancel: boolean;
  canExtend: boolean;
  document?: { id: string; docType: string; number: string | null };
}

export interface EwbDraft {
  request: { supplyType: string; subSupplyType: string; docType: string; docNo: string; fromGstin: string; fromPincode: string | null; toGstin: string; toPincode: string | null; toStateCode: string | null; totalValue: string; items: { hsnCode: string; qty: string; uqc: string }[] };
  defaults: { vehicleNo?: string | null; transporterName?: string | null; transporterId?: string | null; distanceKm?: number; transDocNo?: string | null; transDocDate?: string | null };
  threshold: number;
  required: boolean;
  bills: EwayBill[];
}

export const IRN_CANCEL_REASONS = { "1": "Duplicate", "2": "Data entry mistake", "3": "Order cancelled", "4": "Others" } as const;
export const EWB_CANCEL_REASONS = { "1": "Duplicate", "2": "Order cancelled", "3": "Data entry mistake", "4": "Others" } as const;
export const PART_B_REASONS = { "1": "Vehicle breakdown", "2": "Transhipment", "3": "Others", "4": "First time" } as const;
export const EXTEND_REASONS = { "1": "Natural calamity", "2": "Law and order", "4": "Transhipment", "5": "Accident", "99": "Others" } as const;
export const SUB_SUPPLY: Record<string, string> = { "1": "Supply", "2": "Import", "3": "Export", "4": "Job work", "5": "Own use", "6": "Job-work returns", "7": "Sales return", "8": "Others" };
