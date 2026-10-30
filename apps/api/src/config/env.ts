import { accessSync, constants, realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const secret = z
  .string()
  .refine(
    (s) => Buffer.from(s, 'base64').length >= 32,
    'must be at least 32 random bytes, base64-encoded (openssl rand -base64 32)',
  );

// Same relative path from src/config (dev) and dist/config (built).
const repoRoot = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
const isInside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
};

/** Uploaded bytes: an existing, writable folder outside the repo (so never under a served folder). */
const storageDir = z
  .string()
  .refine(isAbsolute, 'must be an absolute path')
  .transform((dir, ctx) => {
    try {
      const real = realpathSync(dir);
      accessSync(real, constants.W_OK);
      if (isInside(real, repoRoot)) {
        ctx.addIssue({ code: 'custom', message: 'must be outside the repository' });
        return z.NEVER;
      }
      return real;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'must exist and be writable' });
      return z.NEVER;
    }
  });

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.url(),
  WEB_ORIGINS: z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.url()).min(1)),
  COOKIE_SECURE: bool,
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(43200).default(120),
  TRUST_PROXY: bool,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CSRF_SECRET: secret,
  /** Keys the email HMAC in login_throttle and in failed-login audit entries. */
  EMAIL_HMAC_SECRET: secret,
  STORAGE_DIR: storageDir,
  STORAGE_QUOTA_MB: z.coerce.number().int().min(1).max(100_000).default(200),
  // Module E's exam service (docs/integration/exam-service.md). Both unset = not installed.
  EXAM_SERVICE_URL: z.url({ protocol: /^https?$/ }).optional(),
  /** Shared with the exam service; it authenticates both directions. */
  SERVICE_TOKEN_EXAM: z.string().min(32, 'must be at least 32 random characters').optional(),
  /** Internal service routes accept non-loopback callers only when true. */
  SERVICE_ALLOW_REMOTE: bool,
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration (see apps/api/.env.example):');
  for (const issue of parsed.error.issues)
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
