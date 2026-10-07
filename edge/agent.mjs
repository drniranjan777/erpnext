#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EdgeAgent } from './lib/agent.mjs';

/**
 * Usage: node agent.mjs [config.json]
 * The config needs `server` (the ERP API base, e.g. https://erp.example.com/api/v1) and `token`
 * (the gateway token from IoT → Gateways). Environment variables NEXTGEN_SERVER and
 * NEXTGEN_DEVICE_TOKEN override the file.
 */
const file = resolve(process.argv[2] ?? 'edge.config.json');
let cfg = {};
try {
  cfg = JSON.parse(readFileSync(file, 'utf8'));
} catch {
  if (!process.env.NEXTGEN_DEVICE_TOKEN) {
    console.error(`Could not read ${file}`);
    process.exit(1);
  }
}
const agent = new EdgeAgent({
  server: process.env.NEXTGEN_SERVER ?? cfg.server,
  token: process.env.NEXTGEN_DEVICE_TOKEN ?? cfg.token,
  bufferFile: cfg.bufferFile ?? 'buffer.jsonl',
  pollMs: cfg.pollMs,
  flushMs: cfg.flushMs,
  heartbeatMs: cfg.heartbeatMs,
});
await agent.start();
setInterval(() => console.log(`${new Date().toISOString()} buffered ${agent.buffer.size}, sent ${agent.stats.sent}, failed sends ${agent.stats.failures}, read errors ${agent.stats.readErrors}`), 60_000);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => (agent.stop(), process.exit(0)));
