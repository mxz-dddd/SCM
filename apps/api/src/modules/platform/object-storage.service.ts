import { createHash, createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/app-error';

interface PresignInput {
  readonly expiresSeconds?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly method: 'GET' | 'HEAD' | 'PUT';
  readonly objectKey?: string;
}

interface ObjectMetadata {
  readonly contentLength: number;
  readonly contentType: string;
  readonly checksumSha256: string | undefined;
  readonly etag: string;
}

function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalPath(bucket: string, objectKey?: string): string {
  return `/${[bucket, ...(objectKey ? objectKey.split('/') : [])]
    .map(encode)
    .join('/')}`;
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function awsTimestamp(now: Date) {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

export function createS3PresignedUrl(input: {
  readonly accessKey: string;
  readonly bucket: string;
  readonly endpoint: string;
  readonly expiresSeconds: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly method: string;
  readonly now: Date;
  readonly objectKey?: string;
  readonly region: string;
  readonly secretKey: string;
}): { readonly headers: Readonly<Record<string, string>>; readonly url: string } {
  const endpoint = new URL(input.endpoint);
  const timestamp = awsTimestamp(input.now);
  const date = timestamp.slice(0, 8);
  const credentialScope = `${date}/${input.region}/s3/aws4_request`;
  const signedHeaderEntries = Object.entries({
    host: endpoint.host,
    ...Object.fromEntries(
      Object.entries(input.headers ?? {}).map(([key, value]) => [
        key.toLowerCase(),
        value.trim().replace(/\s+/g, ' '),
      ]),
    ),
  }).sort(([left], [right]) => left.localeCompare(right));
  const signedHeaders = signedHeaderEntries.map(([key]) => key).join(';');
  const query = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.accessKey}/${credentialScope}`,
    'X-Amz-Date': timestamp,
    'X-Amz-Expires': String(input.expiresSeconds),
    'X-Amz-SignedHeaders': signedHeaders,
  });
  const canonicalQuery = [...query.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .join('&');
  const canonicalRequest = [
    input.method,
    canonicalPath(input.bucket, input.objectKey),
    canonicalQuery,
    signedHeaderEntries.map(([key, value]) => `${key}:${value}\n`).join(''),
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    timestamp,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretKey}`, date), input.region), 's3'),
    'aws4_request',
  );
  query.set(
    'X-Amz-Signature',
    createHmac('sha256', signingKey).update(stringToSign).digest('hex'),
  );
  endpoint.pathname = canonicalPath(input.bucket, input.objectKey);
  endpoint.search = query.toString();
  return {
    headers: Object.fromEntries(
      signedHeaderEntries.filter(([key]) => key !== 'host'),
    ),
    url: endpoint.toString(),
  };
}

@Injectable()
export class ObjectStorageService {
  readonly bucket = process.env.ATTACHMENT_BUCKET ?? 'scm-attachments';
  private readonly accessKey = process.env.MINIO_ROOT_USER ?? 'scm-local';
  private readonly endpoint = process.env.MINIO_ENDPOINT ?? 'http://127.0.0.1:9000';
  private readonly region = process.env.MINIO_REGION ?? 'us-east-1';
  private readonly secretKey = process.env.MINIO_ROOT_PASSWORD ?? 'scm-local-secret';

  presign(input: PresignInput) {
    return createS3PresignedUrl({
      accessKey: this.accessKey,
      bucket: this.bucket,
      endpoint: this.endpoint,
      expiresSeconds: input.expiresSeconds ?? 900,
      ...(input.headers ? { headers: input.headers } : {}),
      method: input.method,
      now: new Date(),
      ...(input.objectKey ? { objectKey: input.objectKey } : {}),
      region: this.region,
      secretKey: this.secretKey,
    });
  }

  async ensureBucket(): Promise<void> {
    const signed = this.presign({ method: 'PUT' });
    try {
      const response = await fetch(signed.url, { method: 'PUT' });
      if (!response.ok && response.status !== 409) {
        throw new Error(`status ${response.status}`);
      }
    } catch (error) {
      throw new AppError(
        'OBJECT_STORAGE_UNAVAILABLE',
        `Object storage is unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
        503,
        { retryable: true },
      );
    }
  }

  async headObject(objectKey: string): Promise<ObjectMetadata> {
    const signed = this.presign({ method: 'HEAD', objectKey });
    try {
      const response = await fetch(signed.url, { method: 'HEAD' });
      if (!response.ok) {
        throw new AppError(
          'ATTACHMENT_UPLOAD_NOT_FOUND',
          'The uploaded object was not found or is not readable',
          response.status === 404 ? 409 : 503,
          { retryable: response.status !== 404 },
        );
      }
      const checksumHeader = response.headers.get('x-amz-checksum-sha256');
      return {
        checksumSha256: checksumHeader
          ? Buffer.from(checksumHeader, 'base64').toString('hex')
          : (response.headers.get('x-amz-meta-sha256') ?? undefined),
        contentLength: Number(response.headers.get('content-length') ?? '-1'),
        contentType: response.headers.get('content-type') ?? '',
        etag: (response.headers.get('etag') ?? '').replaceAll('"', ''),
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        'OBJECT_STORAGE_UNAVAILABLE',
        'Object storage metadata lookup failed',
        503,
        { retryable: true },
      );
    }
  }

  async download(objectKey: string): Promise<Buffer> {
    const signed = this.presign({ method: 'GET', objectKey });
    const response = await fetch(signed.url);
    if (!response.ok) {
      throw new AppError(
        'OBJECT_STORAGE_DOWNLOAD_FAILED',
        'Object storage download failed',
        503,
        { retryable: true },
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }
}
