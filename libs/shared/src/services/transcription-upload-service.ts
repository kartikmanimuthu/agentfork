import crypto from 'crypto';
import { getPrismaClient } from '../db/prisma-client';
import type { PrismaClient } from '@prisma/client';
import { S3Service } from './s3-service';
import { createLogger } from '../logging/logger';
import { env } from '../env';

const logger = createLogger('transcription-upload-service');

const MIN_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 3600;

export interface CreateTranscriptionUploadInput {
  apiKeyId: string;
  fileName?: string;
  mimeType: string;
  clientReference?: string;
  declaredSizeBytes?: number;
  expiresInSeconds?: number;
}

export interface CreateTranscriptionUploadResult {
  uploadId: string;
  url: string;
  fields: Record<string, string>;
  s3Key: string;
  expiresAt: Date;
  expiresInSeconds: number;
  maxBytes: number;
  clientReference: string | null;
}

/** Recognised audio containers, detected from leading bytes rather than a declared header. */
export type DetectedAudioFormat = 'mp3' | 'wav' | 'm4a' | 'amr';

/**
 * Identifies MP3/WAV/M4A/AMR from a file's magic bytes. S3 only ever validates the
 * client-declared Content-Type, so this is the only place the real container is verified.
 *
 * WAV: `RIFF` at 0..3 and `WAVE` at 8..11.
 * MP3: an `ID3` tag, or a frame sync (0xFF followed by a byte whose top 3 bits are set).
 * M4A: an ISO base media (MP4) container — 4-byte size field then `ftyp` at 4..7.
 * AMR: the literal `#!AMR` (narrowband) or `#!AMR-WB` (wideband) header.
 */
export function detectAudioFormat(head: Buffer): DetectedAudioFormat | null {
  if (head.length >= 12 && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WAVE') {
    return 'wav';
  }
  if (head.length >= 3 && head.toString('ascii', 0, 3) === 'ID3') return 'mp3';
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return 'mp3';
  if (head.length >= 8 && head.toString('ascii', 4, 8) === 'ftyp') return 'm4a';
  if (head.length >= 5 && head.toString('ascii', 0, 5) === '#!AMR') return 'amr';
  return null;
}

/**
 * Upload intents for the two-API transcription flow.
 *
 * A row is created when we hand out a presigned POST policy and consumed when a
 * transcription job claims it. Its `id` is the caller-facing `uploadId` — the single stable
 * identifier they hold from presign, through the webhook, to transcript retrieval. Its
 * `s3Key` is never rewritten (unlike `TranscriptionJob.s3Key`, which is updated when the
 * object is moved into the job folder), so the identifier survives processing.
 */
export class TranscriptionUploadService {
  private readonly prisma: PrismaClient;

  constructor(
    private readonly tenantId: string,
    prisma: PrismaClient = getPrismaClient()
  ) {
    this.prisma = prisma;
  }

  private maxBytes(): number {
    return env.TRANSCRIPTION_MAX_AUDIO_MB * 1024 * 1024;
  }

  /** Mints a presigned POST policy and records the upload intent. */
  async createPresigned(input: CreateTranscriptionUploadInput): Promise<CreateTranscriptionUploadResult> {
    try {
      const maxBytes = this.maxBytes();
      if (input.declaredSizeBytes && input.declaredSizeBytes > maxBytes) {
        throw new Error(`Declared size exceeds the ${env.TRANSCRIPTION_MAX_AUDIO_MB}MB limit`);
      }

      const expiresInSeconds = Math.min(
        MAX_TTL_SECONDS,
        Math.max(MIN_TTL_SECONDS, input.expiresInSeconds ?? env.TRANSCRIPTION_UPLOAD_URL_TTL_SECONDS)
      );

      // Server derives the key from the authenticated tenant — a client-supplied path is
      // never trusted. Mirrors the layout used by the legacy multipart upload route.
      const safeName = (input.fileName || 'audio').replace(/[^\w.\-]+/g, '_').slice(-120);
      const s3Key = `transcription/_uploads/${this.tenantId}/${crypto.randomUUID()}-${safeName}`;
      const mimeType = input.mimeType.toLowerCase();

      const { url, fields } = await new S3Service().createUploadPost(s3Key, mimeType, maxBytes, expiresInSeconds);
      const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

      const row = await this.prisma.transcriptionUpload.create({
        data: {
          tenantId: this.tenantId,
          apiKeyId: input.apiKeyId,
          s3Key,
          fileName: input.fileName ?? null,
          mimeType,
          declaredSizeBytes: input.declaredSizeBytes ?? null,
          clientReference: input.clientReference ?? null,
          status: 'pending',
          expiresAt,
        },
      });

      logger.info(
        { tenantId: this.tenantId, uploadId: row.id, apiKeyId: input.apiKeyId, expiresInSeconds },
        'Transcription upload presigned'
      );

      return {
        uploadId: row.id,
        url,
        fields,
        s3Key,
        expiresAt,
        expiresInSeconds,
        maxBytes,
        clientReference: row.clientReference,
      };
    } catch (error) {
      logger.error(
        { tenantId: this.tenantId, apiKeyId: input.apiKeyId, error },
        'Failed to presign transcription upload'
      );
      throw error;
    }
  }

  /** Tenant-scoped lookup. Returns null for another tenant's id, so callers can 404 uniformly. */
  async findById(uploadId: string) {
    try {
      return await this.prisma.transcriptionUpload.findFirst({
        where: { id: uploadId, tenantId: this.tenantId },
        include: { jobs: { select: { id: true }, take: 1 } },
      });
    } catch (error) {
      logger.error({ tenantId: this.tenantId, uploadId, error }, 'Failed to load transcription upload');
      throw error;
    }
  }

  /** Marks the upload claimed by a transcription job, recording the size S3 actually stored. */
  async markConsumed(uploadId: string, actualSizeBytes: number | null) {
    try {
      return await this.prisma.transcriptionUpload.update({
        where: { id: uploadId },
        data: { status: 'consumed', consumedAt: new Date(), actualSizeBytes },
      });
    } catch (error) {
      logger.error({ tenantId: this.tenantId, uploadId, error }, 'Failed to mark transcription upload consumed');
      throw error;
    }
  }

  /**
   * Flags still-pending uploads whose presign window has closed. Keeps `status` honest so
   * the transcribe route can answer `410 upload_expired` from data rather than inferring it
   * from a timestamp. Storage reclaim is handled separately by the S3 lifecycle rule.
   */
  static async expireStale(prisma: PrismaClient, now = new Date()): Promise<number> {
    const result = await prisma.transcriptionUpload.updateMany({
      where: { status: 'pending', expiresAt: { lt: now } },
      data: { status: 'expired' },
    });
    if (result.count > 0) {
      logger.info({ count: result.count }, 'Marked stale transcription uploads expired');
    }
    return result.count;
  }
}
