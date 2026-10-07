import { createHash } from 'node:crypto';
import { DiskBuffer } from './buffer.mjs';
import { decodeWords, ModbusTcpClient, wordsFor } from './modbus.mjs';
import { MqttSubscriber, topicMatches } from './mqtt.mjs';
import { DeadbandFilter, scaled, Simulator, valueFrom } from './signals.mjs';

export const AGENT_VERSION = '1.0.0';

/**
 * The NextGen edge agent. It downloads its signal list from the ERP, reads the machines (Modbus
 * TCP, MQTT, HTTP JSON or the simulator), filters unchanged values, keeps every reading in a disk
 * buffer and sends the buffer in batches. A batch is removed only after the ERP accepts it; a
 * batch re-sent after a drop has the same id and is applied once.
 */
export class EdgeAgent {
  /**
   * @param {{ server: string, token: string, bufferFile: string, pollMs?: number, flushMs?: number, batchSize?: number,
   *   heartbeatMs?: number, fetch?: typeof fetch, log?: (msg: string) => void, now?: () => number }} opts
   */
  constructor(opts) {
    this.server = opts.server.replace(/\/$/, '');
    this.token = opts.token;
    this.pollMs = opts.pollMs ?? 1000;
    this.flushMs = opts.flushMs ?? 2000;
    this.batchSize = opts.batchSize ?? 1000;
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.log = opts.log ?? ((m) => console.log(`${new Date().toISOString()} ${m}`));
    this.now = opts.now ?? Date.now;
    this.buffer = new DiskBuffer(opts.bufferFile);
    this.filter = new DeadbandFilter(opts.heartbeatMs ?? 60_000);
    this.simulator = new Simulator(this.now());
    /** @type {any[]} */
    this.signals = [];
    /** @type {Map<string, ModbusTcpClient>} */
    this.modbus = new Map();
    /** @type {MqttSubscriber[]} */
    this.mqtt = [];
    this.stats = { sent: 0, batches: 0, failures: 0, readErrors: 0, unknown: [] };
    this.timers = [];
  }

  headers() {
    return { 'content-type': 'application/json', 'x-device-token': this.token };
  }

  /** Downloads the signal list and (re)starts the MQTT subscriptions. */
  async refreshConfig() {
    const res = await this.fetch(`${this.server}/iot/device/config`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Config download failed (HTTP ${res.status})`);
    const cfg = await res.json();
    this.applyConfig(cfg.signals);
    this.log(`Gateway ${cfg.gateway.code}: ${this.signals.length} signal(s)`);
    return cfg;
  }

  applyConfig(signals) {
    this.signals = signals;
    for (const m of this.mqtt) m.stop();
    this.mqtt = [];
    const brokers = new Map();
    for (const s of signals.filter((x) => x.source.protocol === 'mqtt')) {
      const url = s.source.endpoint ?? 'mqtt://localhost:1883';
      brokers.set(url, [...(brokers.get(url) ?? []), s]);
    }
    for (const [url, sigs] of brokers) {
      const sub = new MqttSubscriber({ url, username: sigs[0].source.username, password: sigs[0].source.password, qos: 1 }, [...new Set(sigs.map((s) => s.source.address))], (topic, payload) => {
        const t = this.now();
        const got = [];
        for (const s of sigs) {
          if (!topicMatches(s.source.address, topic)) continue;
          const v = valueFrom(payload, s.source.path);
          if (v !== null) this.keep(s, scaled(v, s), t, got);
        }
        this.buffer.append(got);
      });
      this.mqtt.push(sub.start());
    }
  }

  keep(sig, v, t, out) {
    if (this.filter.accept(sig, v, t)) out.push({ s: sig.code, t, v });
  }

  /** Reads every polled signal once and buffers the values that changed. */
  async pollOnce() {
    const t = this.now();
    const got = [];
    const httpCache = new Map();
    for (const s of this.signals) {
      const src = s.source;
      try {
        if (src.protocol === 'simulator') this.keep(s, scaled(this.simulator.value(s, t), s), t, got);
        else if (src.protocol === 'modbus-tcp') {
          const [host, port] = String(src.endpoint ?? 'localhost:502').split(':');
          const key = `${host}:${port ?? 502}`;
          if (!this.modbus.has(key)) this.modbus.set(key, new ModbusTcpClient({ host, port: Number(port ?? 502) }));
          const type = src.dataType ?? 'uint16';
          const words = await this.modbus.get(key).read(Number(src.unitId ?? 1), src.table ?? 'holding', Number(src.address), src.table === 'coil' ? 1 : wordsFor(type));
          this.keep(s, scaled(src.table === 'coil' ? words[0] : decodeWords(words, type, !!src.swap), s), t, got);
        } else if (src.protocol === 'http-json') {
          if (!httpCache.has(src.address)) httpCache.set(src.address, this.fetch(src.address).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))));
          const v = valueFrom(await httpCache.get(src.address), src.path);
          if (v !== null) this.keep(s, scaled(v, s), t, got);
        }
      } catch (e) {
        this.stats.readErrors++;
        if (this.stats.readErrors % 50 === 1) this.log(`Read failed for ${s.code}: ${e instanceof Error ? e.message : e}`);
      }
    }
    this.buffer.append(got);
    return got.length;
  }

  /** Sends the oldest buffered readings; returns how many the ERP took. */
  async flushOnce() {
    const batch = this.buffer.peek(this.batchSize);
    const batchId = batch.length ? createHash('sha1').update(JSON.stringify(batch)).digest('hex').slice(0, 32) : `hb-${this.now()}`;
    let res;
    try {
      res = await this.fetch(`${this.server}/iot/device/ingest`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ batchId, agentVersion: AGENT_VERSION, buffered: this.buffer.size, readings: batch }),
      });
    } catch (e) {
      this.stats.failures++;
      return 0;
    }
    if (res.status === 400) {
      // Readings the ERP will never take: drop them rather than block the buffer.
      this.log(`Batch ${batchId} refused: ${(await res.text()).slice(0, 200)}`);
      this.buffer.commit(batch.length);
      return 0;
    }
    if (!res.ok) {
      this.stats.failures++;
      if (res.status === 401) this.log('The ERP does not recognise this gateway token');
      return 0;
    }
    const out = await res.json();
    this.buffer.commit(batch.length);
    this.stats.sent += out.accepted;
    this.stats.batches++;
    if (out.unknown?.length) this.stats.unknown = out.unknown;
    return out.accepted;
  }

  async start() {
    await this.refreshConfig().catch((e) => this.log(`${e.message}; using no signals until the ERP is reachable`));
    let polling = false;
    let flushing = false;
    this.timers.push(
      setInterval(async () => {
        if (polling) return;
        polling = true;
        await this.pollOnce().finally(() => (polling = false));
      }, this.pollMs),
      setInterval(async () => {
        if (flushing) return;
        flushing = true;
        try {
          while ((await this.flushOnce()) > 0 && this.buffer.size > 0);
        } finally {
          flushing = false;
        }
      }, this.flushMs),
      setInterval(() => this.refreshConfig().catch(() => undefined), 5 * 60_000),
    );
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    for (const m of this.mqtt) m.stop();
    for (const c of this.modbus.values()) c.close();
  }
}
