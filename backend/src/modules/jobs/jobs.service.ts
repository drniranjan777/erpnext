import { hostname } from 'node:os';
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jobs, type Transaction } from '@nextgen/database';
import { sql } from 'drizzle-orm';
import type { Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';

export interface JobRecord {
  id: string;
  tenant_id: string;
  queue: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export interface JobContext {
  tenantId: string;
  jobId: string;
  attempt: number;
}

export type JobHandler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<void>;

/** Throw to fail a job without retrying (bad payload, recipient gone...). */
export class PermanentJobError extends Error {}

const POLL_MS = 1_000;
const BATCH = 10;

/**
 * PostgreSQL job queue (ADR-013).
 * - enqueue() inside the caller's transaction → the job exists iff the business change commits.
 * - The worker claims with FOR UPDATE SKIP LOCKED (jobs_claim), so many workers can run safely.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Jobs');
  private readonly handlers = new Map<string, JobHandler>();
  private readonly workerId = `${hostname()}:${process.pid}`;
  private readonly enabled: boolean;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopping = false;

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('WORKER_ENABLED', { infer: true });
  }

  register(queue: string, handler: JobHandler) {
    this.handlers.set(queue, handler);
  }

  async enqueue(
    tx: Transaction,
    tenantId: string,
    queue: string,
    payload: Record<string, unknown>,
    opts: { runAt?: Date; maxAttempts?: number; dedupeKey?: string } = {},
  ): Promise<string | null> {
    const [row] = await tx
      .insert(jobs)
      .values({
        tenantId,
        queue,
        payload,
        runAt: opts.runAt ?? new Date(),
        maxAttempts: opts.maxAttempts ?? 5,
        dedupeKey: opts.dedupeKey ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: jobs.id });
    return row?.id ?? null;
  }

  onApplicationBootstrap() {
    if (!this.enabled) return;
    this.logger.log(`Worker ${this.workerId} polling queues: ${[...this.handlers.keys()].join(', ') || '(none)'}`);
    this.schedule(POLL_MS);
  }

  async onApplicationShutdown() {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    // Let an in-flight batch finish (bounded wait).
    for (let i = 0; this.running && i < 50; i++) await new Promise((r) => setTimeout(r, 100));
  }

  /** Processes ready jobs until the queue is empty. Exposed for tests/ops. */
  async drain(): Promise<number> {
    let total = 0;
    for (;;) {
      const n = await this.tick();
      total += n;
      if (n < BATCH) return total;
    }
  }

  private schedule(ms: number) {
    if (this.stopping) return;
    this.timer = setTimeout(async () => {
      let processed = 0;
      try {
        processed = await this.tick();
      } catch (err) {
        this.logger.error(`Worker tick failed: ${(err as Error).message}`);
      }
      // Keep going immediately while there is a backlog.
      this.schedule(processed >= BATCH ? 0 : POLL_MS);
    }, ms);
  }

  private async tick(): Promise<number> {
    if (this.running || !this.handlers.size) return 0;
    this.running = true;
    try {
      const res = await this.database.pool.query<JobRecord>('select * from jobs_claim($1, $2, $3)', [
        this.workerId,
        [...this.handlers.keys()],
        BATCH,
      ]);
      for (const job of res.rows) await this.process(job);
      return res.rows.length;
    } finally {
      this.running = false;
    }
  }

  private async process(job: JobRecord) {
    const handler = this.handlers.get(job.queue);
    try {
      if (!handler) throw new PermanentJobError(`No handler for queue ${job.queue}`);
      await handler(job.payload, { tenantId: job.tenant_id, jobId: job.id, attempt: job.attempts });
      await this.database.pool.query('select jobs_complete($1)', [job.id]);
    } catch (err) {
      const permanent = err instanceof PermanentJobError;
      const message = err instanceof Error ? err.message : String(err);
      const res = await this.database.pool.query<{ status: string }>('select jobs_fail($1, $2, $3) as status', [job.id, message, !permanent]);
      const status = res.rows[0]?.status;
      (status === 'dead' ? this.logger.error.bind(this.logger) : this.logger.warn.bind(this.logger))(
        `Job ${job.queue} ${job.id} attempt ${job.attempts} failed (${status}): ${message}`,
      );
    }
  }

  /** Queue health for the ops page. */
  async stats(tenantId: string) {
    return this.database.run({ tenantId }, async (tx) => {
      const res = await tx.execute<{ queue: string; status: string; n: number }>(
        sql`select queue, status, count(*)::int as n from jobs group by queue, status order by queue, status`,
      );
      return res.rows;
    });
  }
}
