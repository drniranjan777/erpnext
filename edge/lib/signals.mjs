/**
 * What to send: scaling, deadband filtering (with a heartbeat so a steady value still shows the
 * machine is alive), JSON payload paths and the built-in simulator used for demos and testing.
 */

/** Engineering value from a raw one. */
export const scaled = (raw, sig) => Math.round((raw * (sig.scale ?? 1) + (sig.offset ?? 0)) * 1e6) / 1e6;

export class DeadbandFilter {
  /** @param {number} heartbeatMs a value is re-sent at least this often even when unchanged */
  constructor(heartbeatMs = 60_000) {
    this.heartbeatMs = heartbeatMs;
    /** @type {Map<string, { v: number, t: number }>} */
    this.last = new Map();
  }

  /** @param {{ code: string, deadband?: number, counter?: boolean }} sig @param {number} v @param {number} t */
  accept(sig, v, t) {
    const prev = this.last.get(sig.code);
    const send = !prev || (sig.counter ? v !== prev.v : Math.abs(v - prev.v) > (sig.deadband ?? 0)) || t - prev.t >= this.heartbeatMs;
    if (send) this.last.set(sig.code, { v, t });
    return send;
  }
}

/** Reads a dotted path ("data.temp" or "values.0") from a parsed JSON payload. */
export function pick(obj, path) {
  if (!path) return obj;
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** A number from an MQTT or HTTP payload: a plain number, true/false, or JSON with a path. */
export function valueFrom(payload, path) {
  const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload);
  let v;
  try {
    v = pick(JSON.parse(text), path);
  } catch {
    v = text.trim();
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === 'true' || v === 'ON' || v === 'on') return 1;
  if (v === 'false' || v === 'OFF' || v === 'off') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Simulated signals for demos and commissioning, by `source.address`:
 *  - "sine:min:max:periodSec"  a smooth wave (temperatures, pressures)
 *  - "counter:perMinute"       a counter that rises while the machine runs (part counts, kWh)
 *  - "state:runPct"            1 (running) for runPct % of each 10-minute cycle, else 0
 *  - "noise:mean:spread"       random values around a mean (vibration)
 */
export class Simulator {
  constructor(start = Date.now()) {
    this.start = start;
    this.counters = new Map();
  }

  /** @param {{ code: string, source: { address?: string } }} sig @param {number} t */
  value(sig, t) {
    const [kind, a, b, c] = String(sig.source.address ?? 'noise:0:1').split(':');
    const el = (t - this.start) / 1000;
    if (kind === 'sine') {
      const min = Number(a);
      const max = Number(b);
      const period = Number(c) || 600;
      return Math.round((min + ((max - min) * (1 + Math.sin((2 * Math.PI * el) / period))) / 2) * 100) / 100;
    }
    if (kind === 'counter') {
      const perMin = Number(a) || 1;
      const prev = this.counters.get(sig.code) ?? { v: 0, t };
      const v = prev.v + (perMin * (t - prev.t)) / 60_000;
      this.counters.set(sig.code, { v, t });
      return Math.floor(v);
    }
    if (kind === 'state') return (el % 600) / 6 < (Number(a) || 80) ? 1 : 0;
    const mean = Number(a) || 0;
    const spread = Number(b) || 1;
    return Math.round((mean + (Math.random() - 0.5) * 2 * spread) * 1000) / 1000;
  }
}
