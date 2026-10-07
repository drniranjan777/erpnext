import { mkdtempSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript modules of the edge agent
import { EdgeAgent } from '../../../edge/lib/agent.mjs';
// @ts-expect-error plain JavaScript modules of the edge agent
import { decodeWords, encodeWords } from '../../../edge/lib/modbus.mjs';
import { blocked, checksDue, judge, startChecks, type StartContext } from '../../src/modules/mes/poka-yoke';

const base: StartContext = {
  today: '2026-10-08',
  operatorName: 'Ravi',
  skills: [{ operatorName: 'ravi', level: 2, validUntil: '2027-03-31' }],
  operation: { workCenterId: 'wc1', toolCode: 'MLD-CR' },
  machine: { code: 'IMM-01', workCenterId: 'wc1', requiresCleaning: false, cleanStatus: 'clean', assetDown: false },
  otherOperator: null,
  tool: { code: 'MLD-CR', status: 'available', lifeShots: 100_000, shotsUsed: 40_000 },
  scannedTool: 'mld-cr',
  required: [{ itemId: 'pp', code: 'PP', name: 'PP granules' }],
  scanned: [{ code: 'PP', batchNo: 'B1', itemId: 'pp', itemCode: 'PP', batch: { qcStatus: 'released', expiryDate: null }, batchMissing: false }],
  instruction: { confirmSteps: [0, 2], scanMaterials: true },
  stepsAcked: [0, 1, 2],
};

describe('start checks (poka-yoke)', () => {
  it('lets a correct start through', () => {
    const c = startChecks(base);
    expect(blocked(c)).toEqual([]);
    expect(c.map((x) => x.code)).toEqual(['operator', 'skill', 'machine_wc', 'machine_up', 'tool', 'tool_status', 'tool_life', 'material', 'instructions']);
  });

  it('blocks the wrong tool, an unqualified operator, a held batch, missing material and unread steps', () => {
    const c = startChecks({
      ...base,
      operatorName: 'Sita',
      scannedTool: 'MLD-OTHER',
      scanned: [{ code: 'PP', batchNo: 'B2', itemId: 'pp', itemCode: 'PP', batch: { qcStatus: 'quarantine', expiryDate: null }, batchMissing: false }],
      required: [...base.required, { itemId: 'mb', code: 'MB', name: 'Masterbatch' }],
      stepsAcked: [0],
    });
    expect(blocked(c).map((x) => [x.code, x.detail])).toEqual([
      ['skill', 'Sita has no recorded skill here'],
      ['tool', 'MLD-OTHER is not the tool for this operation'],
      ['material', 'Batch is quarantine'],
      ['material_missing', 'Scan Masterbatch before starting'],
      ['instructions', 'Confirm step 3'],
    ]);
  });

  it('warns without blocking on tool wear, conditional lots and another operator logged in', () => {
    const c = startChecks({
      ...base,
      tool: { ...base.tool!, shotsUsed: 95_000 },
      scanned: [{ ...base.scanned[0], batch: { qcStatus: 'conditional', expiryDate: null } }],
      otherOperator: 'Kiran',
    });
    expect(blocked(c)).toEqual([]);
    expect(c.filter((x) => !x.ok).map((x) => x.code)).toEqual(['session', 'tool_life', 'material']);
  });

  it('blocks a machine under breakdown, on another work centre or not cleaned, and expired qualifications', () => {
    const c = startChecks({ ...base, machine: { ...base.machine!, workCenterId: 'wc2', assetDown: true, requiresCleaning: true, cleanStatus: 'dirty' }, skills: [{ operatorName: 'Ravi', level: 3, validUntil: '2026-09-30' }] });
    expect(blocked(c).map((x) => x.code)).toEqual(['skill', 'machine_wc', 'machine_up', 'machine_clean']);
  });

  it('judges readings and says which in-line checks are due', () => {
    const chars = [{ name: 'Wall thickness', unit: 'mm', min: 1.8, max: 2.2, everyMinutes: 30 }, { name: 'Weight', unit: 'g', min: 410, max: 430 }];
    expect(judge(chars, [{ name: 'wall thickness', value: 2.3 }, { name: 'Weight', value: 420 }, { name: 'Colour', value: 1 }])).toEqual([
      { name: 'Wall thickness', value: 2.3, ok: false, known: true },
      { name: 'Weight', value: 420, ok: true, known: true },
      { name: 'Colour', value: 1, ok: false, known: false },
    ]);
    expect(checksDue(chars, 0, null, 29 * 60_000)).toEqual([]);
    expect(checksDue(chars, 0, null, 31 * 60_000)).toEqual(['Wall thickness']);
    expect(checksDue(chars, 0, 20 * 60_000, 31 * 60_000)).toEqual([]);
  });
});

describe('edge agent: writing set-points', () => {
  const servers: net.Server[] = [];
  afterEach(() => {
    for (const s of servers.splice(0)) s.close();
  });

  it('encodes values into registers', () => {
    for (const [v, t] of [[235.5, 'float32'], [-12, 'int16'], [70000, 'uint32'], [-70000, 'int32']] as const) expect(decodeWords(encodeWords(v, t), t)).toBeCloseTo(v, 3);
    expect(encodeWords(1, 'uint32', true)).toEqual([1, 0]);
  });

  it('writes a recipe to a PLC over Modbus and reports the result to the ERP', async () => {
    const regs = new Map<number, number>();
    const server = net.createServer((sock) =>
      sock.on('data', (req) => {
        const fc = req.readUInt8(7);
        const addr = req.readUInt16BE(8);
        if (fc === 6) regs.set(addr, req.readUInt16BE(10));
        if (fc === 16) for (let i = 0; i < req.readUInt16BE(10); i++) regs.set(addr + i, req.readUInt16BE(13 + i * 2));
        const res = Buffer.from(req.subarray(0, 12));
        res.writeUInt16BE(6, 4);
        sock.write(res);
      }),
    );
    servers.push(server);
    const port = await new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as net.AddressInfo).port)));
    const results: any[] = [];
    const fetch = async (url: string, init?: { body?: string }) => {
      if (url.endsWith('/commands'))
        return {
          ok: true,
          json: async () => [
            {
              id: 'c1',
              payload: {
                writes: [
                  { name: 'Barrel temp', value: 235.5, protocol: 'modbus-tcp', endpoint: `127.0.0.1:${port}`, address: '100', dataType: 'float32' },
                  { name: 'Hold pressure', value: 80, protocol: 'modbus-tcp', endpoint: `127.0.0.1:${port}`, address: '110', scale: 0.1 },
                ],
              },
            },
          ],
        };
      results.push(JSON.parse(init!.body!));
      return { ok: true, json: async () => ({}) };
    };
    const agent = new EdgeAgent({ server: 'http://erp/api/v1', token: 'x', bufferFile: join(mkdtempSync(join(tmpdir(), 'edge-')), 'buffer.jsonl'), fetch, log: () => undefined });
    expect(await agent.runCommands()).toBe(1);
    agent.stop();
    expect(decodeWords([regs.get(100), regs.get(101)], 'float32')).toBeCloseTo(235.5, 3);
    expect(regs.get(110)).toBe(800);
    expect(results).toEqual([{ ok: true, message: 'Written: Barrel temp=235.5, Hold pressure=80' }]);
  });
});
