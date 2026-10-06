import type { DocumentHeader } from "./documents";

export const JW = { challans: "/job-work/challans", receipts: "/job-work/receipts" } as const;

export interface ChallanLine {
  id: string;
  lineNo: number;
  itemId: string;
  itemCode: string;
  description: string;
  uomCode: string;
  qty: string;
  rate: string;
  value: string;
  hsnCode: string | null;
  goodsType: "inputs" | "capital_goods";
  batchNo: string | null;
  costValue: string;
  consumedQty: string;
  returnedQty: string;
  lossQty: string;
  pendingQty: string;
  dueBy: string;
  daysToDue: number | null;
}

export interface Challan extends DocumentHeader {
  jobWorker: { id: string; code: string; name: string; gstin: string | null; stateCode: string | null };
  jobWorkerAddress: { line1?: string; city?: string; pincode?: string };
  warehouse: { id: string; code: string; name: string } | null;
  jobWorkWarehouse: { id: string; code: string; name: string } | null;
  process: string;
  expectedReturnDate: string | null;
  transporter: string | null;
  vehicleNo: string | null;
  totalValue: string;
  ewayBillNo: string | null;
  notes: string | null;
  lines: ChallanLine[];
  receipts: { id: string; number: string | null; status: string; docDate: string; jwChallanNo: string | null; jobCharges: string }[];
  pendingQty: string;
  canReceive: boolean;
}

export interface Receipt extends DocumentHeader {
  challan: { id: string; number: string | null; docDate: string };
  jobWorker: { id: string; name: string; gstin: string | null };
  warehouse: { id: string; code: string; name: string };
  jwChallanNo: string | null;
  jwChallanDate: string | null;
  natureOfJob: string | null;
  jobCharges: string;
  notes: string | null;
  lines: { id: string; lineNo: number; kind: "output" | "material"; itemCode: string; itemName: string; uomCode: string; qty: string; consumedQty: string; returnedQty: string; lossQty: string; batchNo: string | null; value: string }[];
}
