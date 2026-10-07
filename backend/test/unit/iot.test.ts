import { mkdtempSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript modules of the edge agent
import { EdgeAgent } from '../../../edge/lib/agent.mjs';
// @ts-expect-error plain JavaScript modules of the edge agent
import { DiskBuffer } from '../../../edge/lib/buffer.mjs';
// @ts-expect-error plain JavaScript modules of the edge agent
import { decodeWords, ModbusTcpClient } from '../../../edge/lib/modbus.mjs';
// @ts-expect-error plain JavaScript modules of the edge agent
import { encodeLength, MqttSubscriber, publishPacket, readPacket, topicMatches } from '../../../edge/lib/mqtt.mjs';
// @ts-expect-error plain JavaScript modules of the edge agent
import { DeadbandFilter, Simulator, valueFrom } from '../../../edge/lib/signals.mjs';
import { bucketSeconds, describeRule, stepRule, type RuleLimits } from '../../src/modules/iot/rules';

const at = (s: number) => new Date(Date.UTC(2026, 9, 8, 6, 0, s));
const servers: net.Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});
const listen = (s: net.Server) =>
  new Promise<number>((resolve) => {
    servers.push(s);
    s.listen(0, '127.0.0.1', () => resolve((s.address() as net.AddressInfo).port));
  });

describe('alarm rules', () => {
  const hot: RuleLimits = { op: 'above', threshold: 80, threshold2: null, delaySeconds: 30 };

  it('raises only after the breach has held for the delay, tracks the peak and clears', () => {
    const r1 = stepRule(hot, { pendingSince: null, open: null }, [
      { ts: at(0), value: 85 },
      { ts: at(10), value: 79 },
      { ts: at(20), value: 82 },
      { ts: at(40), value: 90 },
    ]);
    expect(r1.events).toEqual([]);
    expect(r1.state.pendingSince).toEqual(at(20));
    const r2 = stepRule(hot, r1.state, [
      { ts: at(50), value: 88 },
      { ts: at(55), value: 95 },
      { ts: at(70), value: 70 },
    ]);
    expect(r2.events).toEqual([
      { kind: 'raise', at: at(50), value: 88 },
      { kind: 'clear', at: at(70), peak: 95 },
    ]);
    expect(r2.state).toEqual({ pendingSince: null, open: null });
  });

  it('handles bands and immediate alarms', () => {
    const band: RuleLimits = { op: 'outside', threshold: 2, threshold2: 8, delaySeconds: 0 };
    const r = stepRule(band, { pendingSince: null, open: null }, [
      { ts: at(0), value: 9 },
      { ts: at(1), value: 0.5 },
    ]);
    expect(r.events).toEqual([{ kind: 'raise', at: at(0), value: 9 }]);
    expect(r.state.open).toEqual({ peak: 0.5 });
    expect(describeRule(band, '°C')).toBe('outside 2–8 °C');
    expect(describeRule(hot, null)).toBe('above 80 for 30 s');
  });

  it('sizes chart buckets', () => {
    expect(bucketSeconds(at(0), new Date(at(0).getTime() + 86_400_000), 240)).toBe(600);
    expect(bucketSeconds(at(0), at(60), 240)).toBe(1);
  });
});

describe('edge agent: Modbus TCP', () => {
  it('reads holding registers and decodes 32-bit values', async () => {
    const regs = [0x0001, 0x86a0, 0x4148, 0xf5c3];
    const port = await listen(
      net.createServer((sock) =>
        sock.on('data', (req) => {
          const tid = req.readUInt16BE(0);
          const addr = req.readUInt16BE(8);
          const count = req.readUInt16BE(10);
          const data = Buffer.alloc(count * 2);
          for (let i = 0; i < count; i++) data.writeUInt16BE(regs[addr + i], i * 2);
          const res = Buffer.alloc(9);
          res.writeUInt16BE(tid, 0);
          res.writeUInt16BE(0, 2);
          res.writeUInt16BE(3 + data.length, 4);
          res.writeUInt8(req.readUInt8(6), 6);
          res.writeUInt8(3, 7);
          res.writeUInt8(data.length, 8);
          sock.write(Buffer.concat([res, data]));
        }),
      ),
    );
    const c = new ModbusTcpClient({ host: '127.0.0.1', port });
    expect(decodeWords(await c.read(1, 'holding', 0, 2), 'uint32')).toBe(100000);
    expect(decodeWords(await c.read(1, 'holding', 2, 2), 'float32')).toBeCloseTo(12.56, 2);
    c.close();
    expect(decodeWords([0xffff], 'int16')).toBe(-1);
  });
});

describe('edge agent: MQTT', () => {
  it('encodes lengths, matches wildcards and parses packets', () => {
    expect([...encodeLength(321)]).toEqual([0xc1, 0x02]);
    expect(topicMatches('plant/+/temp', 'plant/imm01/temp')).toBe(true);
    expect(topicMatches('plant/#', 'plant/imm01/temp')).toBe(true);
    expect(topicMatches('plant/+', 'plant/imm01/temp')).toBe(false);
    const p = readPacket(publishPacket('a/b', '{"v":1}'));
    expect(p).toMatchObject({ type: 3, size: 14 });
    expect(valueFrom(Buffer.from('{"data":{"temp":71.5}}'), 'data.temp')).toBe(71.5);
    expect(valueFrom(Buffer.from('ON'))).toBe(1);
  });

  it('subscribes to a broker and receives messages', async () => {
    const port = await listen(
      net.createServer((sock) =>
        sock.on('data', (chunk) => {
          const type = chunk[0] >> 4;
          if (type === 1) sock.write(Buffer.from([0x20, 2, 0, 0]));
          if (type === 8) {
            sock.write(Buffer.from([0x90, 3, chunk[2], chunk[3], 0]));
            sock.write(publishPacket('plant/imm01/temp', '{"t":64.2}'));
          }
        }),
      ),
    );
    const got = await new Promise<[string, number]>((resolve) => {
      const sub = new MqttSubscriber({ url: `mqtt://127.0.0.1:${port}` }, ['plant/+/temp'], (topic: string, payload: Buffer) => {
        sub.stop();
        resolve([topic, valueFrom(payload, 't')]);
      }).start();
    });
    expect(got).toEqual(['plant/imm01/temp', 64.2]);
  });
});

describe('edge agent: buffering and sending', () => {
  it('filters by deadband with a heartbeat; counters send every change', () => {
    const f = new DeadbandFilter(60_000);
    const temp = { code: 't', deadband: 0.5 };
    expect([f.accept(temp, 70, 0), f.accept(temp, 70.3, 1000), f.accept(temp, 70.6, 2000), f.accept(temp, 70.6, 62_000)]).toEqual([true, false, true, true]);
    const count = { code: 'c', counter: true };
    expect([f.accept(count, 5, 0), f.accept(count, 5, 1), f.accept(count, 6, 2)]).toEqual([true, false, true]);
    const sim = new Simulator(0);
    expect(sim.value({ code: 'x', source: { address: 'counter:60' } }, 0)).toBe(0);
    expect(sim.value({ code: 'x', source: { address: 'counter:60' } }, 10_000)).toBe(10);
  });

  it('keeps readings on disk until the ERP accepts them and re-sends the same batch id', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'edge-')), 'buffer.jsonl');
    const calls: any[] = [];
    let online = false;
    const fetch = async (url: string, init?: { body?: string }) => {
      if (url.endsWith('/config')) return { ok: true, json: async () => ({ gateway: { code: 'GW1' }, signals: [{ code: 'IMM-01.shots', counter: true, scale: 1, offset: 0, deadband: 0, source: { protocol: 'simulator', address: 'counter:60' } }] }) };
      calls.push(JSON.parse(init!.body!));
      if (!online) throw new Error('network down');
      return { ok: true, status: 200, json: async () => ({ accepted: calls.at(-1).readings.length, unknown: [] }) };
    };
    let t = 1_000_000;
    const agent = new EdgeAgent({ server: 'http://erp/api/v1', token: 'x', bufferFile: file, fetch, now: () => t, log: () => undefined });
    await agent.refreshConfig();
    for (let i = 0; i < 3; i++) {
      await agent.pollOnce();
      t += 2000;
    }
    expect(await agent.flushOnce()).toBe(0);
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(3);
    const restarted = new EdgeAgent({ server: 'http://erp/api/v1', token: 'x', bufferFile: file, fetch, now: () => t, log: () => undefined });
    online = true;
    expect(await restarted.flushOnce()).toBe(3);
    expect(calls[1].batchId).toBe(calls[0].batchId);
    expect(calls[1].readings.map((r: any) => r.v)).toEqual([0, 2, 4]);
    expect(restarted.buffer.size).toBe(0);
    expect(new DiskBuffer(file).size).toBe(0);
  });
});
