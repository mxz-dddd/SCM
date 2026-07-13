import { describe, expect, it } from 'vitest';
import { createS3PresignedUrl } from './object-storage.service';

describe('S3-compatible presigned uploads', () => {
  it('signs the method, object key and required upload metadata deterministically', () => {
    const input = {
      accessKey: 'test-access',
      bucket: 'attachments',
      endpoint: 'http://127.0.0.1:9000',
      expiresSeconds: 900,
      headers: {
        'content-type': 'application/pdf',
        'x-amz-checksum-sha256': Buffer.from('a'.repeat(64), 'hex').toString(
          'base64',
        ),
        'x-amz-meta-sha256': 'a'.repeat(64),
      },
      method: 'PUT',
      now: new Date('2026-07-14T08:30:00.000Z'),
      objectKey: 'tenant/业务文件.pdf',
      region: 'us-east-1',
      secretKey: 'test-secret',
    } as const;
    const first = createS3PresignedUrl(input);
    const replay = createS3PresignedUrl(input);

    expect(replay).toEqual(first);
    expect(first.url).toContain('/attachments/tenant/%E4%B8%9A%E5%8A%A1%E6%96%87%E4%BB%B6.pdf');
    expect(first.url).toContain('X-Amz-Signature=');
    expect(decodeURIComponent(first.url)).toContain(
      'X-Amz-SignedHeaders=content-type;host;x-amz-checksum-sha256;x-amz-meta-sha256',
    );
    expect(first.headers).toEqual(input.headers);
    expect(
      createS3PresignedUrl({ ...input, method: 'GET' }).url,
    ).not.toBe(first.url);
  });
});
