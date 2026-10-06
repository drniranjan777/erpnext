import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Injectable, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';

export interface StoredObject {
  key: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * File storage. Local-disk driver for development; the same interface will be
 * backed by S3 (ap-south-1) / MinIO in deployed environments.
 */
@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(config: ConfigService<Env, true>) {
    this.root = resolve(config.get('STORAGE_DIR', { infer: true }));
  }

  async put(tenantId: string, stream: Readable, maxBytes: number): Promise<StoredObject> {
    const now = new Date();
    const key = `${tenantId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}`;
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });

    const hash = createHash('sha256');
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        if (size > maxBytes) return cb(new PayloadTooLargeException(`File is larger than ${Math.round(maxBytes / 1_048_576)} MB`));
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(stream, meter, createWriteStream(path, { flags: 'wx' }));
    } catch (err) {
      await rm(path, { force: true });
      throw err;
    }
    return { key, sizeBytes: size, sha256: hash.digest('hex') };
  }

  async open(key: string): Promise<Readable> {
    const path = this.pathFor(key);
    await stat(path); // throws ENOENT if missing
    return createReadStream(path);
  }

  /** Resolves a key inside the storage root (refuses path traversal). */
  private pathFor(key: string) {
    const path = resolve(join(this.root, key));
    if (!path.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return path;
  }
}
