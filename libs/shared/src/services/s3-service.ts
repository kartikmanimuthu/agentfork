import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env";
import { createLogger } from "../logging/logger";

const logger = createLogger('s3-service');

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

  async downloadAsBuffer(key: string): Promise<Buffer> {
    const bucket = this.getBucket();
    logger.info({ bucket, key }, 'Downloading object from S3');
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key })
      );
      if (!response.Body) throw new Error(`S3 object not found: ${key}`);

      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      logger.info({ bucket, key, sizeBytes: buffer.length }, 'S3 object downloaded');
      return buffer;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(
        { bucket, key, errorMessage: error.message, errorStack: error.stack },
        'Failed to download object from S3'
      );
      throw error;
    }
  }

  async uploadBuffer(
    key: string,
    body: Buffer,
    contentType?: string
  ): Promise<void> {
    const bucket = this.getBucket();
    logger.info({ bucket, key, contentType, sizeBytes: body.length }, 'Uploading buffer to S3');
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        })
      );
      logger.info({ bucket, key }, 'Buffer uploaded to S3 successfully');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(
        { bucket, key, contentType, sizeBytes: body.length, errorMessage: error.message, errorStack: error.stack },
        'Failed to upload buffer to S3'
      );
      throw error;
    }
  }
}
