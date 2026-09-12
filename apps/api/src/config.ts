import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('0.0.0.0'),
  APP_BASE_URL: z.string().url().default('http://localhost:4000'),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16),
  ENCRYPTION_KEY: z.string().min(16),
  RATE_LIMIT_DEFAULT_MAX: z.coerce.number().int().default(300),
  RATE_LIMIT_DEFAULT_WINDOW: z.string().default('1 minute'),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().default(10),
  RATE_LIMIT_AUTH_WINDOW: z.string().default('1 minute'),
  // Sprint 5: email / sequence worker
  UNSUB_SECRET: z.string().min(16).default('dev-unsub-secret-rotate-in-prod-please'),
  PUBLIC_HOSTNAME: z.string().default('localhost:4000'),
  // Sprint 6: LLM client (Anthropic-compatible — works with MiniMax via base URL)
  LLM_PROVIDER: z.enum(['anthropic', 'openai']).default('anthropic'),
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.string().url().optional(),
  LLM_MODEL: z.string().default('MiniMax-M3'),
  LLM_TIMEOUT_MS: z.coerce.number().int().default(60_000),
  LLM_MAX_RETRIES: z.coerce.number().int().default(2),

  // Sprint Customer Zero: OAuth providers for onboarding capabilities.
  // When a provider's envs are not set, the corresponding /api/v1/auth/oauth/<provider>/start
  // endpoint returns 503 with a precise message — no fake buttons in the UI.
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
  MICROSOFT_OAUTH_CLIENT_ID: z.string().optional(),
  MICROSOFT_OAUTH_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_OAUTH_TENANT_ID: z.string().default('common'),
  MICROSOFT_OAUTH_REDIRECT_URI: z.string().url().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
