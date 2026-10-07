import net from 'node:net';

/**
 * Minimal Modbus TCP client (function codes 1 coils, 3 holding registers, 4 input registers).
 * One request at a time per connection, which is how most PLCs expect to be polled.
 */
export class ModbusTcpClient {
  /** @param {{ host: string, port?: number, timeoutMs?: number }} opts */
  constructor(opts) {
    this.host = opts.host;
    this.port = opts.port ?? 502;
    this.timeoutMs = opts.timeoutMs ?? 3000;
    this.tid = 0;
    /** @type {net.Socket | null} */
    this.socket = null;
    this.chain = Promise.resolve();
  }

  async connect() {
    if (this.socket && !this.socket.destroyed) return;
    this.socket = await new Promise((resolve, reject) => {
      const s = net.createConnection({ host: this.host, port: this.port });
      const fail = (e) => {
        s.destroy();
        reject(e);
      };
      s.setTimeout(this.timeoutMs, () => fail(new Error(`Modbus ${this.host}:${this.port} connect timeout`)));
      s.once('error', fail);
      s.once('connect', () => {
        s.setTimeout(0);
        s.removeListener('error', fail);
        s.on('error', () => s.destroy());
        resolve(s);
      });
    });
  }

  close() {
    this.socket?.destroy();
    this.socket = null;
  }

  /**
   * Reads `count` registers (or coils) starting at `address`; returns 16-bit words, or 0/1 per coil.
   * @param {number} unitId @param {'holding'|'input'|'coil'} table @param {number} address @param {number} count
   * @returns {Promise<number[]>}
   */
  read(unitId, table, address, count) {
    const run = this.chain.then(() => this.request(unitId, table === 'coil' ? 1 : table === 'input' ? 4 : 3, address, count));
    this.chain = run.catch(() => undefined);
    return run;
  }

  async request(unitId, fc, address, count) {
    await this.connect();
    const s = /** @type {net.Socket} */ (this.socket);
    const tid = (this.tid = (this.tid + 1) & 0xffff);
    const req = Buffer.alloc(12);
    req.writeUInt16BE(tid, 0);
    req.writeUInt16BE(0, 2);
    req.writeUInt16BE(6, 4);
    req.writeUInt8(unitId, 6);
    req.writeUInt8(fc, 7);
    req.writeUInt16BE(address, 8);
    req.writeUInt16BE(count, 10);
    return new Promise((resolve, reject) => {
      let buf = Buffer.alloc(0);
      const done = (err, val) => {
        clearTimeout(timer);
        s.removeListener('data', onData);
        s.removeListener('close', onClose);
        if (err) {
          this.close();
          reject(err);
        } else resolve(val);
      };
      const onClose = () => done(new Error('Modbus connection closed'));
      const onData = (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        if (buf.length < 7) return;
        const len = buf.readUInt16BE(4);
        if (buf.length < 6 + len) return;
        const frame = buf.subarray(0, 6 + len);
        if (frame.readUInt16BE(0) !== tid) return done(new Error('Modbus transaction id mismatch'));
        if (frame.readUInt8(7) & 0x80) return done(new Error(`Modbus exception ${frame.readUInt8(8)} (function ${fc})`));
        const bytes = frame.readUInt8(8);
        const data = frame.subarray(9, 9 + bytes);
        if (fc === 1) {
          const bits = [];
          for (let i = 0; i < count; i++) bits.push((data[i >> 3] >> (i & 7)) & 1);
          return done(null, bits);
        }
        const words = [];
        for (let i = 0; i + 1 < data.length; i += 2) words.push(data.readUInt16BE(i));
        done(null, words);
      };
      const timer = setTimeout(() => done(new Error(`Modbus ${this.host}:${this.port} read timeout`)), this.timeoutMs);
      s.on('data', onData);
      s.once('close', onClose);
      s.write(req);
    });
  }
}

/** Number of 16-bit registers a data type takes. */
export const wordsFor = (dataType) => (['uint32', 'int32', 'float32'].includes(dataType) ? 2 : 1);

/**
 * Decodes registers into a number: big-endian word order (high word first) unless `swap`.
 * @param {number[]} words @param {string} [dataType] @param {boolean} [swap]
 */
export function decodeWords(words, dataType = 'uint16', swap = false) {
  const b = Buffer.alloc(4);
  const [hi, lo] = swap ? [words[1], words[0]] : [words[0], words[1]];
  switch (dataType) {
    case 'int16':
      b.writeUInt16BE(words[0], 0);
      return b.readInt16BE(0);
    case 'uint32':
      return hi * 65536 + lo;
    case 'int32':
      b.writeUInt16BE(hi, 0);
      b.writeUInt16BE(lo, 2);
      return b.readInt32BE(0);
    case 'float32':
      b.writeUInt16BE(hi, 0);
      b.writeUInt16BE(lo, 2);
      return b.readFloatBE(0);
    default:
      return words[0];
  }
}
