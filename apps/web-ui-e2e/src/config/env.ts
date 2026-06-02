import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/**
 * Typed, validated environment for the E2E suite.
 *
 * This is the ONLY place `process.env` is read — every spec, fixture, POM,
 * and the Playwright config import the typed `env` object from here, per the
 * repo standard ("never access process.env directly").
 *
 * Uses `@t3-oss/env-core` (not `-nextjs`) because the suite runs under bun
 * with no Next.js runtime. `emptyStringAsUndefined` is intentionally `false`:
 * the SSO defaults rely on `''` surviving so `hasSsoCreds()` can gate the
 * Cognito tests.
 */
export const env = createEnv({
  server: {
    NEXTAUTH_SECRET: z.string().min(1).default('test-secret-for-e2e'),
    E2E_SSO_EMAIL: z.string().default(''),
    E2E_SSO_PASSWORD: z.string().default(''),
    CI: z.string().optional(),
    E2E_GREP: z.string().optional(),
    E2E_GREP_INVERT: z.string().optional(),
    BASE_URL: z.string().url().default('http://localhost:3005'),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: false,
});

/** True when both SSO credentials are present — gates the Cognito specs. */
export const hasSsoCreds = (): boolean =>
  Boolean(env.E2E_SSO_EMAIL && env.E2E_SSO_PASSWORD);
