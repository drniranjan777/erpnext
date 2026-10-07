import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  /** Public URL of the web app (used in invitation links). */
  APP_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().url(),
  /** Local file storage root for attachments (dev). Deployed envs will use S3. */
  STORAGE_DIR: z.string().default('./.storage'),
  /** Run the background job worker inside this process. */
  WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** smtp(s)://user:pass@host:port. Empty = write emails as .eml files to MAIL_DIR (dev). */
  SMTP_URL: z.string().optional().default(''),
  EMAIL_FROM: z.string().default('NextGen ERP <no-reply@nextgenerp.in>'),
  MAIL_DIR: z.string().default('./.mail'),
  /** 32-byte key (base64) for encrypting secrets at rest (MFA seeds, webhook secrets). */
  DATA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded'),
  /** Comma-separated emails allowed into the platform super-admin console. */
  PLATFORM_ADMIN_EMAILS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)),
  /** "mock" = built-in test checkout (no money moves); "razorpay" = live/test Razorpay subscriptions. */
  BILLING_PROVIDER: z.enum(['mock', 'razorpay']).default('mock'),
  RAZORPAY_KEY_ID: z.string().optional().default(''),
  RAZORPAY_KEY_SECRET: z.string().optional().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(''),
  /** JSON map of "<plan>:<cycle>" to Razorpay plan_id, e.g. {"growth:monthly":"plan_ABC"}. */
  RAZORPAY_PLAN_IDS: z.string().optional().default('{}'),
  /** Seller details printed on our SaaS GST invoices. */
  SAAS_SELLER_NAME: z.string().default('NextGen ERP Technologies Pvt Ltd'),
  SAAS_SELLER_GSTIN: z.string().default('36AAACN0000A1ZM'),
  SAAS_SELLER_STATE_CODE: z.string().length(2).default('36'),
  SAAS_SELLER_ADDRESS: z.string().default('Hyderabad, Telangana 500081'),
  /** Allow webhooks to private/localhost addresses (development only). */
  WEBHOOKS_ALLOW_PRIVATE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** WhatsApp provider: "log" (dev) until a Meta/BSP account is configured. */
  WHATSAPP_PROVIDER: z.enum(['log', 'disabled']).default('log'),
  /** GST Suvidha Provider for e-invoice / e-way bill: "sandbox" simulates the NIC APIs locally. */
  GSP_PROVIDER: z.enum(['sandbox']).default('sandbox'),
  /** Anthropic API key for AI document capture (purchase bills). Empty = text-only capture. */
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  AI_MODEL: z.string().default('claude-sonnet-5-5'),
  /** Requests slower than this are logged (performance budget, p95 < 300 ms). */
  SLOW_REQUEST_MS: z.coerce.number().int().min(1).default(300),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof envSchema>;

/** Validates process.env at boot - the app refuses to start with bad config. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
