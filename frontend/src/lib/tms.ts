export const TMS = "/tms";

export interface Stop {
  id: string;
  seq: number;
  status: string;
  city: string | null;
  address: string | null;
  deliveryId: string | null;
  deliveryNumber: string | null;
  customer: string | null;
  phone: string | null;
  packages: number | null;
  grossWeightKg: string | null;
  arrivedAt: string | null;
  deliveredAt: string | null;
  receivedBy: string | null;
  note: string | null;
  signature?: string | null;
  photo?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface Trip {
  id: string;
  number: string;
  tripDate: string;
  status: string;
  vehicleNo: string;
  vehicleType: string | null;
  driverName: string | null;
  driverPhone: string | null;
  transporter: string | null;
  plannedKm: number | null;
  odometerStart: number | null;
  odometerEnd: number | null;
  odometerKm?: number | null;
  weightKg: string | null;
  freightAmount?: string | null;
  freightBasis?: string | null;
  expenses: { kind: string; amount: string; note?: string | null }[];
  expensesTotal?: string;
  warehouse: string | null;
  freightBill: string | null;
  stops: Stop[];
  lastPosition: { lat: number; lng: number; at: string; speedKmh: string | null; source: string } | null;
  trackedKm: number;
  trail?: { lat: number; lng: number; at: string }[];
}

export const TRIP_TONE: Record<string, "neutral" | "primary" | "success" | "warning" | "danger"> = { planned: "primary", dispatched: "warning", completed: "success", cancelled: "neutral" };
export const STOP_TONE: Record<string, "neutral" | "primary" | "success" | "warning" | "danger"> = { pending: "neutral", arrived: "warning", delivered: "success", failed: "danger" };
export const mapLink = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=14/${lat}/${lng}`;
