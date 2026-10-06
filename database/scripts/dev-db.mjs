#!/usr/bin/env node
/**
 * Local development PostgreSQL cluster for NextGen ERP.
 *
 * Runs a project-local cluster (database/.dev-db) on its own port so it never
 * touches other PostgreSQL instances on the machine. Requires PostgreSQL 18+
 * binaries (native uuidv7()).
 *
 *   node scripts/dev-db.mjs init     # create cluster, roles, database, .env files
 *   node scripts/dev-db.mjs start
 *   node scripts/dev-db.mjs stop
 *   node scripts/dev-db.mjs status
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const DB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_DIR = resolve(DB_DIR, '..');
const ENV_FILE = join(DB_DIR, '.env');
const BACKEND_ENV_FILE = join(ROOT_DIR, 'backend', '.env');
const DATA_DIR = join(DB_DIR, '.dev-db');
const LOG_FILE = join(DB_DIR, '.dev-db.log');
const DB_NAME = 'nextgen_erp';

function parseEnv(file) {
  if (!existsSync(file)) return {};
  const env = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const secret = () => randomBytes(18).toString('base64url');

function loadConfig() {
  const env = parseEnv(ENV_FILE);
  return {
    pgBin: env.PG_BIN || process.env.PG_BIN || 'C:/Program Files/PostgreSQL/18/bin',
    port: Number(env.DEV_DB_PORT || 5434),
    env,
  };
}

function bin(cfg, name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const p = join(cfg.pgBin, exe);
  if (!existsSync(p)) {
    console.error(`PostgreSQL binary not found: ${p}\nSet PG_BIN in database/.env to your PostgreSQL 18 bin directory.`);
    process.exit(1);
  }
  return p;
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: opts.input ? ['pipe', 'inherit', 'inherit'] : 'inherit', ...opts });
  if (res.status !== 0 && !opts.allowFail) {
    console.error(`Command failed: ${cmd} ${args.join(' ')}`);
    process.exit(res.status ?? 1);
  }
  return res;
}

function isRunning(cfg) {
  if (!existsSync(DATA_DIR)) return false;
  const res = spawnSync(bin(cfg, 'pg_ctl'), ['status', '-D', DATA_DIR], { stdio: 'pipe' });
  return res.status === 0;
}

function start(cfg) {
  if (isRunning(cfg)) {
    console.log(`Dev database already running on 127.0.0.1:${cfg.port}`);
    return;
  }
  if (!existsSync(DATA_DIR)) {
    console.error('Dev cluster not initialised. Run: npm run db:init');
    process.exit(1);
  }
  // stdio 'ignore': the postmaster inherits our handles on Windows, which would
  // keep parent pipes open forever. Output goes to the log file instead.
  const res = spawnSync(bin(cfg, 'pg_ctl'), ['start', '-D', DATA_DIR, '-l', LOG_FILE, '-w', '-o', `-p ${cfg.port}`], {
    stdio: 'ignore',
  });
  if (res.status !== 0) {
    console.error(`Failed to start dev database. See ${LOG_FILE}`);
    process.exit(res.status ?? 1);
  }
  console.log(`Dev database started on 127.0.0.1:${cfg.port}`);
}

function stop(cfg) {
  if (!isRunning(cfg)) {
    console.log('Dev database is not running.');
    return;
  }
  run(bin(cfg, 'pg_ctl'), ['stop', '-D', DATA_DIR, '-m', 'fast', '-w']);
}

function init(cfg) {
  if (existsSync(DATA_DIR)) {
    console.log('Dev cluster already exists at database/.dev-db. Starting it.');
    start(cfg);
    return;
  }

  // 1. Secrets (generated once, kept in database/.env, git-ignored)
  const env = cfg.env;
  const superPw = env.DEV_DB_SUPERUSER_PASSWORD || secret();
  const ownerPw = secret();
  const appPw = secret();
  const seedPw = env.SEED_ADMIN_PASSWORD || secret();
  const ownerUrl = `postgres://nextgen_owner:${ownerPw}@127.0.0.1:${cfg.port}/${DB_NAME}`;
  const appUrl = `postgres://nextgen_app:${appPw}@127.0.0.1:${cfg.port}/${DB_NAME}`;

  // 2. initdb
  const pwFile = join(tmpdir(), `nextgen-pw-${process.pid}`);
  writeFileSync(pwFile, superPw);
  try {
    run(bin(cfg, 'initdb'), ['-D', DATA_DIR, '-U', 'postgres', `--pwfile=${pwFile}`, '-A', 'scram-sha-256', '-E', 'UTF8', '--locale=C']);
  } finally {
    rmSync(pwFile, { force: true });
  }
  appendFileSync(
    join(DATA_DIR, 'postgresql.conf'),
    `\n# NextGen ERP dev settings\nlisten_addresses = '127.0.0.1'\nport = ${cfg.port}\ntimezone = 'UTC'\nlog_timezone = 'UTC'\n`,
  );

  start(cfg);

  // 3. Roles and database (SQL piped through stdin so secrets stay out of argv)
  const psql = bin(cfg, 'psql');
  const psqlEnv = { ...process.env, PGPASSWORD: superPw };
  const base = ['-v', 'ON_ERROR_STOP=1', '-q', '-h', '127.0.0.1', '-p', String(cfg.port), '-U', 'postgres'];
  run(psql, [...base, '-d', 'postgres'], {
    env: psqlEnv,
    input: `
      CREATE ROLE nextgen_owner LOGIN PASSWORD '${ownerPw}';
      CREATE ROLE nextgen_app LOGIN PASSWORD '${appPw}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      CREATE DATABASE ${DB_NAME} OWNER nextgen_owner;
    `,
  });
  run(psql, [...base, '-d', DB_NAME], {
    env: psqlEnv,
    input: `
      REVOKE ALL ON SCHEMA public FROM PUBLIC;
      ALTER SCHEMA public OWNER TO nextgen_owner;
      GRANT USAGE ON SCHEMA public TO nextgen_app;
      ALTER DEFAULT PRIVILEGES FOR ROLE nextgen_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nextgen_app;
      ALTER DEFAULT PRIVILEGES FOR ROLE nextgen_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO nextgen_app;
      ALTER DEFAULT PRIVILEGES FOR ROLE nextgen_owner IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO nextgen_app;
    `,
  });

  // 4. Write env files
  writeFileSync(
    ENV_FILE,
    [
      '# Local development only - generated by scripts/dev-db.mjs. Do not commit.',
      `PG_BIN=${cfg.pgBin}`,
      `DEV_DB_PORT=${cfg.port}`,
      `DEV_DB_SUPERUSER_PASSWORD=${superPw}`,
      `DATABASE_OWNER_URL=${ownerUrl}`,
      `DATABASE_URL=${appUrl}`,
      `SEED_ADMIN_EMAIL=${env.SEED_ADMIN_EMAIL || 'admin@demo.local'}`,
      `SEED_ADMIN_PASSWORD=${seedPw}`,
      '',
    ].join('\n'),
  );
  if (!existsSync(BACKEND_ENV_FILE)) {
    const example = join(ROOT_DIR, 'backend', '.env.example');
    let content = existsSync(example) ? readFileSync(example, 'utf8') : '';
    content = content
      .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${appUrl}`)
      .replace(/^JWT_ACCESS_SECRET=.*$/m, `JWT_ACCESS_SECRET=${randomBytes(32).toString('base64url')}`)
      .replace(/^JWT_REFRESH_SECRET=.*$/m, `JWT_REFRESH_SECRET=${randomBytes(32).toString('base64url')}`)
      .replace(/^DATA_ENCRYPTION_KEY=.*$/m, `DATA_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`)
      .replace(/^PLATFORM_ADMIN_EMAILS=.*$/m, `PLATFORM_ADMIN_EMAILS=${env.SEED_ADMIN_EMAIL || 'admin@demo.local'}`)
      .replace(/^WEBHOOKS_ALLOW_PRIVATE=.*$/m, 'WEBHOOKS_ALLOW_PRIVATE=true');
    if (!/^DATABASE_URL=/m.test(content)) content += `DATABASE_URL=${appUrl}\n`;
    writeFileSync(BACKEND_ENV_FILE, content);
  }

  console.log(`\nDev database ready on 127.0.0.1:${cfg.port} (db: ${DB_NAME}).`);
  console.log('Credentials written to database/.env and backend/.env (git-ignored).');
  console.log('Next: npm run db:migrate && npm run db:seed');
}

const cmd = process.argv[2];
const cfg = loadConfig();
switch (cmd) {
  case 'init':
    init(cfg);
    break;
  case 'start':
    start(cfg);
    break;
  case 'stop':
    stop(cfg);
    break;
  case 'status':
    console.log(isRunning(cfg) ? `running on 127.0.0.1:${cfg.port}` : 'stopped');
    break;
  default:
    console.log('Usage: node scripts/dev-db.mjs <init|start|stop|status>');
    process.exit(1);
}
