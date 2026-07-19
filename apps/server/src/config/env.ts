import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment configuration.
 *
 * Parsed once at boot and validated. A misconfigured deploy should fail
 * immediately and say exactly what is wrong — not surface as a null
 * dereference under load an hour later.
 */

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    LOG_PRETTY: booleanish.default('false'),

    /** Comma-separated allowed origins, or `*` in development. */
    CORS_ORIGIN: z.string().default('http://localhost:5173'),

    /**
     * Persistence mode.
     *
     * `none` runs the entire game in memory with no database and no Redis.
     * Guest play, matchmaking, rooms and combat (plan phases 2-3) all work in
     * this mode — only progression, profiles and leaderboards need `full`.
     * This is what lets development proceed without Docker installed.
     */
    PERSISTENCE: z.enum(['none', 'full']).default('none'),
    DATABASE_URL: z.string().url().optional(),
    REDIS_URL: z.string().url().optional(),

    /** Signs guest session tokens. Must be set in production. */
    SESSION_SECRET: z.string().min(16).default('dev-only-insecure-secret-change-me'),
    SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 30),
  })
  .superRefine((env, ctx) => {
    if (env.PERSISTENCE === 'full') {
      if (!env.DATABASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATABASE_URL'],
          message: 'DATABASE_URL is required when PERSISTENCE=full',
        });
      }
      if (!env.REDIS_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['REDIS_URL'],
          message: 'REDIS_URL is required when PERSISTENCE=full',
        });
      }
    }

    if (env.NODE_ENV === 'production' && env.SESSION_SECRET.startsWith('dev-only')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SESSION_SECRET'],
        message: 'SESSION_SECRET must be set to a real secret in production',
      });
    }
  });

function loadEnv() {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // The logger depends on env, so this one case has to use console directly.
    console.error(`\nInvalid environment configuration:\n${issues}\n`);
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';

/** Parsed CORS origins. `*` disables the allow-list entirely. */
export const corsOrigins: string[] | '*' =
  env.CORS_ORIGIN.trim() === '*'
    ? '*'
    : env.CORS_ORIGIN.split(',')
        .map((o) => o.trim())
        .filter(Boolean);

export type Env = typeof env;
