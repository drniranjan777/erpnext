export interface Gateway {
  id: string;
  code: string;
  name: string;
  location: string | null;
  status: string;
  tokenHint: string | null;
  lastSeenAt: string | null;
  lastIp: string | null;
  agentVersion: string | null;
  buffered: number;
  online: boolean | null;
  signals: number;
  batchesLastHour: number;
}

export interface SignalSource {
  protocol: "modbus-tcp" | "mqtt" | "http-json" | "simulator" | "push";
  endpoint?: string;
  address?: string;
  table?: string;
  dataType?: string;
  unitId?: number;
  path?: string;
  [k: string]: unknown;
}

export interface Signal {
  id: string;
  code: string;
  name: string;
  purpose: string;
  unit: string | null;
  scale: number;
  offset: number;
  deadband: number;
  source: SignalSource;
  isActive: boolean;
  gatewayId: string | null;
  gatewayCode: string | null;
  machineId: string | null;
  machineCode: string | null;
  machineName: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  vehicleNo: string | null;
  lastValue: number | null;
  lastAt: string | null;
  stale: boolean;
  openAlarms: number;
}

export interface AlarmRule {
  id: string;
  signalId: string;
  signalCode: string;
  unit: string | null;
  name: string;
  op: "above" | "below" | "outside" | "equals";
  threshold: number;
  threshold2: number | null;
  delaySeconds: number;
  severity: "info" | "warning" | "critical";
  notify: boolean;
  createMaintenance: boolean;
  isActive: boolean;
}

export interface Alarm {
  id: string;
  severity: "info" | "warning" | "critical";
  message: string;
  raisedAt: string;
  value: number;
  peakValue: number;
  clearedAt: string | null;
  ackedAt: string | null;
  ackedBy: string | null;
  note: string | null;
  maintenanceOrderId: string | null;
  signalId: string;
  signalCode: string;
  unit: string | null;
  machineCode: string | null;
  machineName: string | null;
  ruleName: string;
}

export const PURPOSES: Record<string, string> = {
  part_count: "Part / shot counter",
  reject_count: "Reject counter",
  run_state: "Run state (1 = running)",
  temperature: "Temperature",
  humidity: "Humidity",
  vibration: "Vibration",
  current: "Motor current",
  pressure: "Pressure",
  energy_kwh: "Energy meter (kWh)",
  power_kw: "Power (kW)",
  speed: "Speed",
  other: "Other",
};

export const PROTOCOLS: Record<string, string> = {
  "modbus-tcp": "Modbus TCP",
  mqtt: "MQTT",
  "http-json": "HTTP JSON",
  simulator: "Simulator",
  push: "Sent through the API",
};

export const SEVERITY_TONE = { info: "neutral", warning: "warning", critical: "danger" } as const;

export function fmtValue(v: number | null | undefined, unit?: string | null) {
  if (v === null || v === undefined) return "–";
  const n = Math.abs(v) >= 1000 ? v.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : String(Math.round(v * 100) / 100);
  return unit ? `${n} ${unit}` : n;
}
