import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Agent as HttpsAgent } from "https";
import { env } from "../env";
import { createLogger } from "../logging/logger";
import { withTimeout } from "../utils/with-timeout";

const logger = createLogger('s3-service');

/** Metadata from a HeadObject call — enough to enforce a size cap and read the stored type. */
export interface S3ObjectHead {
  contentType: string | null;
  contentLength: number | null;
  etag: string | null;
}

/** A presigned POST: the bucket endpoint plus the signed form fields the client must send. */
export interface S3PresignedPost {
  url: string;
  fields: Record<string, string>;
}

let sharedClient: S3Client | null = null;

function getS3Client(): S3Client {
  if (sharedClient) return sharedClient;

  const region = env.AWS_REGION;
  const endpoint = env.S3_ENDPOINT;
  const forcePathStyle = env.S3_FORCE_PATH_STYLE === "true";

  logger.info({ region, endpoint, forcePathStyle }, 'Initializing S3 client');

  sharedClient = new S3Client({
    followRegionRedirects: true,
    ...(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
      ? { credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } }
      : {}),
    region,
    ...(endpoint ? { endpoint } : {}),
    ...(forcePathStyle ? { forcePathStyle: true } : {}),
    // keepAlive disabled on purpose: this client is a single process-lifetime singleton behind
    // a NAT gateway. A pooled keep-alive connection that sits idle between requests (which
    // happens often here - S3 calls are infrequent, sometimes minutes apart) gets silently
    // killed by the NAT's idle-connection timeout with no signal to the client; the next
    // request on that dead connection then hangs until our own request timeout fires, rather
    // than failing fast. A fresh connection per request costs one extra TLS handshake
    // (~50-150ms) but can never hang on a connection the network has already dropped.
    requestHandler: new NodeHttpHandler({ httpsAgent: new HttpsAgent({ keepAlive: false }) }),
  });
  return sharedClient;
}

export class S3Service {
  private readonly client = getS3Client();

  getBucket(): string {
    return env.S3_BUCKET;
  }

  async getUploadUrl(
    key: string,
    contentType: string,
    expiresIn = 3600
  ): Promise<string> {
    const bucket = this.getBucket();
    logger.info({ bucket, key, contentType, expiresIn }, 'Generating S3 pre-signed upload URL');
    try {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      });
      const url = await getSignedUrl(this.client, command, { expiresIn });
      logger.info({ bucket, key }, 'S3 pre-signed upload URL generated');
      return url;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(
        { bucket, key, contentType, errorMessage: error.message, errorStack: error.stack },
        'Failed to generate S3 pre-signed upload URL'
      );
      throw error;
    }
  }

  /**
   * `timeoutMs` bounds the whole request (connect through the last body byte). A stalled
   * connection (rare, but observed in practice) would otherwise hang this call forever, which
   * for a batchSize:1 job queue means every other queued job waits behind it indefinitely.
   * Uses `withTimeout` as the guaranteed backstop (fires regardless of SDK behavior), plus an
   * AbortController passed into the SDK call so a well-behaved client also frees the
   * underlying connection instead of leaking it in the background.
   */
  async downloadAsBuffer(key: string, timeoutMs = 120_000, attemptTimeoutMs = 45_000): Promise<Buffer> {
    const bucket = this.getBucket();
    logger.info({ bucket, key, timeoutMs }, 'Downloading object from S3');
    // Split the overall budget into short attempts with immediate retry, rather than one
    // long attempt that either succeeds or burns the whole budget before ever trying again.
    // Observed in practice: a stalled GetObject on one attempt is almost always followed by
    // a near-instant success on the very next attempt (same key, same bucket) - a transient
    // connection-level blip, not a real problem with the object or the request. For a
    // batchSize:1 job queue, the old single-long-timeout shape meant every such blip cost the
    // full timeoutMs before the next job could even start; short attempts turn that into an
    // attemptTimeoutMs-ish cost instead. 45s (not something shorter) is deliberate: each retry
    // restarts the download from scratch rather than resuming, so the cap must comfortably
    // exceed how long the LARGEST real file takes on a merely-slow (not dead) connection - the
    // biggest audio file seen in production is ~23MB; even at a degraded 1MB/s that's ~23s, so
    // 45s leaves real margin before a genuinely-fine large download gets mistaken for a stall.
    const deadline = Date.now() + timeoutMs;
    let lastError: Error = new Error(`S3 download failed with no attempts made: ${key}`);
    let attempt = 0;
    while (Date.now() < deadline) {
      attempt += 1;
      const remaining = deadline - Date.now();
      const thisAttemptTimeoutMs = Math.min(attemptTimeoutMs, remaining);
      const controller = new AbortController();
      try {
        const buffer = await withTimeout(
          this.doDownload(bucket, key, controller.signal),
          thisAttemptTimeoutMs,
          `S3 download timed out after ${thisAttemptTimeoutMs}ms: ${key}`
        );
        logger.info({ bucket, key, sizeBytes: buffer.length, attempt }, 'S3 object downloaded');
        return buffer;
      } catch (err) {
        const timedOut = err instanceof Error && err.name === 'TimeoutError';
        if (timedOut) controller.abort();
        const error = err instanceof Error ? err : new Error(String(err));
        // Only a timeout is worth retrying — it's the one failure mode observed to be a
        // transient connection-level blip. Anything else (object not found, access denied, a
        // malformed response) is a permanent failure that retrying can't fix; looping on it
        // would just burn the full timeoutMs budget doing the same doomed request repeatedly.
        if (!timedOut) {
          logger.error(
            { bucket, key, attempt, errorMessage: error.message, errorStack: error.stack },
            'Failed to download object from S3'
          );
          throw error;
        }
        lastError = error;
        logger.warn(
          { bucket, key, attempt, errorMessage: lastError.message },
          'S3 download attempt timed out, retrying'
        );
      }
    }
    logger.error(
      { bucket, key, attempt, errorMessage: lastError.message, errorStack: lastError.stack },
      'S3 download failed after retries'
    );
    throw lastError;
  }

  private async doDownload(bucket: string, key: string, signal: AbortSignal): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { abortSignal: signal }
    );
    if (!response.Body) throw new Error(`S3 object not found: ${key}`);

    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Creates a presigned POST policy for a direct browser/server upload. Unlike a presigned
   * PUT, the policy conditions are enforced by S3 itself — which is the only way to cap
   * upload size server-side. `maxBytes` becomes a `content-length-range` condition and
   * `contentType` an exact match, so neither can be raised by the client (the signature
   * covers the whole policy).
   */
  async createUploadPost(
    key: string,
    contentType: string,
    maxBytes: number,
    expiresIn = 3600
  ): Promise<S3PresignedPost> {
    const bucket = this.getBucket();
    logger.info({ bucket, key, contentType, maxBytes, expiresIn }, 'Generating S3 presigned POST policy');
    try {
      const { url, fields } = await createPresignedPost(this.client, {
        Bucket: bucket,
        Key: key,
        Conditions: [
          ['content-length-range', 1, maxBytes],
          { 'Content-Type': contentType },
        ],
        Fields: {
          'Content-Type': contentType,
          // Makes S3 answer 201 + an XML body (Bucket/Key/ETag) instead of a bare 204,
          // so the caller gets an unambiguous success signal without asking us.
          success_action_status: '201',
        },
        Expires: expiresIn,
      });
      logger.info({ bucket, key }, 'S3 presigned POST policy generated');
      return { url, fields };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(
        { bucket, key, contentType, errorMessage: error.message, errorStack: error.stack },
        'Failed to generate S3 presigned POST policy'
      );
      throw error;
    }
  }

  /** Full HeadObject metadata. Returns null when the object does not exist. */
  async headObject(key: string): Promise<S3ObjectHead | null> {
    const bucket = this.getBucket();
    try {
      const response = await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return {
        contentType: response.ContentType ?? null,
        contentLength: response.ContentLength ?? null,
        etag: response.ETag ?? null,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.warn({ bucket, key, errorMessage: error.message }, 'Failed to head S3 object');
      return null;
    }
  }

  async headContentType(key: string): Promise<string | null> {
    return (await this.headObject(key))?.contentType ?? null;
  }

  /**
   * Reads the first `length` bytes of an object via a ranged GET — used to verify a file's
   * real format from its magic bytes, which no presign policy can do (S3 only ever checks
   * the client-declared Content-Type). Returns null if the object or range is unavailable.
   */
  async getObjectHead(key: string, length = 12): Promise<Buffer | null> {
    const bucket = this.getBucket();
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${length - 1}` })
      );
      if (!response.Body) return null;
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
      return Buffer.concat(chunks);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.warn({ bucket, key, errorMessage: error.message }, 'Failed to read leading bytes of S3 object');
      return null;
    }
  }

  async getDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    const bucket = this.getBucket();
    logger.info({ bucket, key, expiresIn }, 'Generating S3 pre-signed download URL');
    try {
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      const url = await getSignedUrl(this.client, command, { expiresIn });
      logger.info({ bucket, key }, 'S3 pre-signed download URL generated');
      return url;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(
        { bucket, key, errorMessage: error.message, errorStack: error.stack },
        'Failed to generate S3 pre-signed download URL'
      );
      throw error;
    }
  }

  async moveObject(sourceKey: string, destKey: string): Promise<void> {
    const bucket = this.getBucket();
    logger.info({ bucket, sourceKey, destKey }, 'Moving S3 object');
    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: `${bucket}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`,
          Key: destKey,
        })
      );
      await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: sourceKey }));
      logger.info({ bucket, sourceKey, destKey }, 'S3 object moved successfully');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(
        { bucket, sourceKey, destKey, errorMessage: error.message, errorStack: error.stack },
        'Failed to move S3 object'
      );
      throw error;
    }
  }

  /** See `downloadAsBuffer` for why this is bounded by a guaranteed timeout. */
  async uploadBuffer(
    key: string,
    body: Buffer,
    contentType?: string,
    timeoutMs = 60_000
  ): Promise<void> {
    const bucket = this.getBucket();
    logger.info({ bucket, key, contentType, sizeBytes: body.length, timeoutMs }, 'Uploading buffer to S3');
    const controller = new AbortController();
    try {
      await withTimeout(
        this.client.send(
          new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
          { abortSignal: controller.signal }
        ),
        timeoutMs,
        `S3 upload timed out after ${timeoutMs}ms: ${key}`
      );
      logger.info({ bucket, key }, 'Buffer uploaded to S3 successfully');
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      if (timedOut) controller.abort();
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(
        { bucket, key, contentType, sizeBytes: body.length, timedOut, errorMessage: error.message, errorStack: error.stack },
        timedOut ? 'S3 upload timed out' : 'Failed to upload buffer to S3'
      );
      throw error;
    }
  }
}
