import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDb, createPool, withContext, type Database, type DbContext, type Transaction } from '@nextgen/database';
import type { Pool } from 'pg';
import type { Env } from '../config/env';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: Pool;
  readonly db: Database;
  private readonly replicaPool: Pool | null;
  private readonly replica: Database | null;

  constructor(config: ConfigService<Env, true>) {
    this.pool = createPool(config.get('DATABASE_URL', { infer: true }), { max: 20 });
    this.db = createDb(this.pool);
    const replicaUrl = config.get('DATABASE_REPLICA_URL', { infer: true });
    this.replicaPool = replicaUrl ? createPool(replicaUrl, { max: 10 }) : null;
    this.replica = this.replicaPool ? createDb(this.replicaPool) : null;
  }

  /** True when reads can go to a replica. */
  get hasReplica() {
    return !!this.replica;
  }

  /**
   * Runs `fn` in a transaction scoped to a tenant/user so PostgreSQL RLS
   * applies. All tenant data access goes through here.
   */
  run<T>(ctx: DbContext, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withContext(this.db, ctx, fn);
  }

  /**
   * Like run(), for read-only work that may lag the primary by a moment (reports, dashboards): on the
   * replica when one is configured, with the same tenant / user context so RLS applies.
   */
  runRead<T>(ctx: DbContext, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withContext(this.replica ?? this.db, ctx, fn);
  }

  async ping(): Promise<boolean> {
    await this.pool.query('select 1');
    return true;
  }

  async onModuleDestroy() {
    await this.pool.end();
    await this.replicaPool?.end();
  }
}
