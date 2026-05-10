import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env";

let sharedClient: S3Client | null = null;

function getS3Client(): S3Client {
  if (sharedClient) return sharedClient;

  const region = env.AWS_REGION;
  const endpoint = env.S3_ENDPOINT;
  const forcePathStyle = env.S3_FORCE_PATH_STYLE === "true";

  sharedClient = new S3Client({
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
    const command = new PutObjectCommand({
      Bucket: this.getBucket(),
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  async downloadAsBuffer(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.getBucket(), Key: key })
    );
    if (!response.Body) throw new Error(`S3 object not found: ${key}`);

    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async uploadBuffer(
    key: string,
    body: Buffer,
    contentType?: string
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.getBucket(),
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
  }
}
