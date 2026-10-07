import net from 'node:net';

/**
 * Minimal MQTT 3.1.1 subscriber over TCP (mqtt://host:port): CONNECT with optional username and
 * password, SUBSCRIBE at QoS 0 or 1, PUBACK for QoS 1, keep-alive pings and reconnect with
 * back-off. Enough to read machine data from a plant broker (Mosquitto, EMQX, HiveMQ, or a PLC's
 * built-in broker).
 */
export class MqttSubscriber {
  /**
   * @param {{ url: string, clientId?: string, username?: string, password?: string, keepAlive?: number, qos?: 0|1 }} opts
   * @param {string[]} topics
   * @param {(topic: string, payload: Buffer) => void} onMessage
   */
  constructor(opts, topics, onMessage) {
    const u = new URL(opts.url);
    this.host = u.hostname;
    this.port = Number(u.port || 1883);
    this.opts = opts;
    this.topics = topics;
    this.onMessage = onMessage;
    this.keepAlive = opts.keepAlive ?? 30;
    this.retryMs = 1000;
    this.stopped = false;
    this.connected = false;
    this.packetId = 0;
    this.buf = Buffer.alloc(0);
  }

  start() {
    this.stopped = false;
    this.open();
    return this;
  }

  stop() {
    this.stopped = true;
    clearInterval(this.ping);
    this.socket?.destroy();
  }

  open() {
    const s = net.createConnection({ host: this.host, port: this.port });
    this.socket = s;
    this.buf = Buffer.alloc(0);
    s.on('connect', () => s.write(connectPacket(this.opts.clientId ?? `nextgen-edge-${process.pid}`, this.keepAlive, this.opts.username, this.opts.password)));
    s.on('data', (chunk) => this.receive(chunk));
    s.on('error', () => undefined);
    s.on('close', () => {
      this.connected = false;
      clearInterval(this.ping);
      if (this.stopped) return;
      setTimeout(() => this.open(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 30_000);
    });
  }

  receive(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const p = readPacket(this.buf);
      if (!p) return;
      this.buf = this.buf.subarray(p.size);
      this.handle(p.type, p.flags, p.body);
    }
  }

  handle(type, flags, body) {
    if (type === 2) {
      // CONNACK: return code 0 is accepted.
      if (body[1] !== 0) {
        this.socket?.destroy();
        return;
      }
      this.connected = true;
      this.retryMs = 1000;
      this.socket?.write(subscribePacket(++this.packetId, this.topics, this.opts.qos ?? 0));
      this.ping = setInterval(() => this.socket?.write(Buffer.from([0xc0, 0])), this.keepAlive * 500);
    } else if (type === 3) {
      // PUBLISH
      const qos = (flags >> 1) & 3;
      const tlen = body.readUInt16BE(0);
      const topic = body.subarray(2, 2 + tlen).toString('utf8');
      let off = 2 + tlen;
      if (qos > 0) {
        const id = body.readUInt16BE(off);
        off += 2;
        this.socket?.write(Buffer.from([0x40, 2, id >> 8, id & 0xff]));
      }
      this.onMessage(topic, body.subarray(off));
    }
  }
}

function str(s) {
  const b = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(b.length);
  return Buffer.concat([len, b]);
}

export function encodeLength(n) {
  const out = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 128;
    out.push(byte);
  } while (n > 0);
  return Buffer.from(out);
}

function packet(header, body) {
  return Buffer.concat([Buffer.from([header]), encodeLength(body.length), body]);
}

export function connectPacket(clientId, keepAlive, username, password) {
  let flags = 0x02;
  if (username) flags |= 0x80;
  if (password) flags |= 0x40;
  const parts = [str('MQTT'), Buffer.from([4, flags]), Buffer.from([keepAlive >> 8, keepAlive & 0xff]), str(clientId)];
  if (username) parts.push(str(username));
  if (password) parts.push(str(password));
  return packet(0x10, Buffer.concat(parts));
}

export function subscribePacket(id, topics, qos) {
  const parts = [Buffer.from([id >> 8, id & 0xff])];
  for (const t of topics) parts.push(str(t), Buffer.from([qos]));
  return packet(0x82, Buffer.concat(parts));
}

export function publishPacket(topic, payload, qos = 0, id = 1) {
  const parts = [str(topic)];
  if (qos) parts.push(Buffer.from([id >> 8, id & 0xff]));
  parts.push(Buffer.from(payload));
  return packet(0x30 | (qos << 1), Buffer.concat(parts));
}

/** Parses one packet from the front of `buf`, or returns null if it is not complete yet. */
export function readPacket(buf) {
  if (buf.length < 2) return null;
  let mult = 1;
  let len = 0;
  let i = 1;
  for (;;) {
    if (i >= buf.length) return null;
    const byte = buf[i++];
    len += (byte & 127) * mult;
    if (!(byte & 128)) break;
    mult *= 128;
    if (i > 4) throw new Error('Malformed MQTT packet length');
  }
  if (buf.length < i + len) return null;
  return { type: buf[0] >> 4, flags: buf[0] & 15, body: buf.subarray(i, i + len), size: i + len };
}

/** MQTT topic filter match with + and # wildcards. */
export function topicMatches(filter, topic) {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

/**
 * Publishes one message and disconnects (QoS 0): used to send set-points to a broker.
 * @param {{ url: string, username?: string, password?: string, timeoutMs?: number }} opts
 * @param {string} topic @param {string} payload
 */
export function mqttPublish(opts, topic, payload) {
  const u = new URL(opts.url);
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host: u.hostname, port: Number(u.port || 1883) });
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      s.destroy();
      reject(new Error(`MQTT ${opts.url} timeout`));
    }, opts.timeoutMs ?? 5000);
    s.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    s.on('connect', () => s.write(connectPacket(`nextgen-edge-pub-${process.pid}`, 10, opts.username, opts.password)));
    s.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const p = readPacket(buf);
      if (!p || p.type !== 2) return;
      clearTimeout(timer);
      if (p.body[1] !== 0) {
        s.destroy();
        return reject(new Error(`MQTT connection refused (${p.body[1]})`));
      }
      s.write(publishPacket(topic, payload), () => {
        s.end(Buffer.from([0xe0, 0]));
        resolve(undefined);
      });
    });
  });
}
