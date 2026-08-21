/**
 * browsing-deps.ts — the concrete collaborators the browsing tools need, kept
 * out of `browser-tools.ts` so that module stays testable without S3 or a DB,
 * and out of `claw-runtime.ts` so that function stays a wiring list.
 */

import { createLogger } from '@chatbot/shared';
import type { ScreenshotUpload } from './browser-tools';

const logger = createLogger('claw-studio:browsing-deps');

/** The subset of S3Service used here — narrowed so tests need no AWS client. */
export interface ScreenshotStore {
  uploadBuffer(key: string, body: Buffer, contentType?: string): Promise<void>;
  getDownloadUrl(key: string, expiresIn?: number): Promise<string>;
}

const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Tenant-first, then claw, then run. Screenshots can capture whatever page the
 * agent was on, so the prefix has to make cross-tenant reads impossible to
 * express by accident, the same way the workspace tables are keyed.
 */
export function screenshotKey(parts: { tenantId: string; clawId: string; runId?: string; seq: number }): string {
  return `claw/screenshots/${parts.tenantId}/${parts.clawId}/${parts.runId ?? 'adhoc'}/${parts.seq}.jpg`;
}

export function createScreenshotUploader(deps: {
  tenantId: string;
  clawId: string;
  runId?: string;
  s3: ScreenshotStore;
}): (body: Buffer) => Promise<ScreenshotUpload> {
  let seq = 0;

  return async (body: Buffer) => {
    seq += 1;
    const key = screenshotKey({ tenantId: deps.tenantId, clawId: deps.clawId, runId: deps.runId, seq });
    // Deliberately not caught: browser-tools turns a rejection into a
    // recoverable tool result, and swallowing it here would hand the model a
    // key pointing at an object that was never written.
    await deps.s3.uploadBuffer(key, body, 'image/jpeg');
    const url = await deps.s3.getDownloadUrl(key, SIGNED_URL_TTL_SECONDS);
    logger.info({ tenantId: deps.tenantId, clawId: deps.clawId, runId: deps.runId, key }, 'Stored browser screenshot');
    return { key, url };
  };
}
