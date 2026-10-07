import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

/**
 * Store-and-forward buffer on disk (one JSON reading per line). Readings are appended as they are
 * read and removed only after the server has accepted them, so nothing is lost while the network
 * or the server is down, and nothing is lost if the agent restarts. When the buffer reaches
 * `maxReadings`, the oldest readings are dropped (and counted) to protect the disk.
 */
export class DiskBuffer {
  /** @param {string} file @param {{ maxReadings?: number }} [opts] */
  constructor(file, opts = {}) {
    this.file = file;
    this.maxReadings = opts.maxReadings ?? 2_000_000;
    this.dropped = 0;
    /** @type {string[]} */
    this.lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
  }

  get size() {
    return this.lines.length;
  }

  /** @param {{ s: string, t: number, v: number }[]} readings */
  append(readings) {
    if (!readings.length) return;
    const add = readings.map((r) => JSON.stringify(r));
    this.lines.push(...add);
    appendFileSync(this.file, add.join('\n') + '\n');
    if (this.lines.length > this.maxReadings) {
      const over = this.lines.length - this.maxReadings;
      this.dropped += over;
      this.lines = this.lines.slice(over);
      this.rewrite();
    }
  }

  /** The oldest `n` readings (not removed until `commit`). */
  peek(n) {
    return this.lines.slice(0, n).map((l) => JSON.parse(l));
  }

  /** Removes the first `n` readings after the server accepted them. */
  commit(n) {
    this.lines = this.lines.slice(n);
    this.rewrite();
  }

  rewrite() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, this.lines.length ? this.lines.join('\n') + '\n' : '');
    renameSync(tmp, this.file);
  }
}
