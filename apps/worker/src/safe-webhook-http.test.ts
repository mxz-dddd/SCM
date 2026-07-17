import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import {
  isPublicAddress,
  readBoundedWebhookBody,
  resolvePublicWebhook,
} from './safe-webhook-http';

describe('safe webhook HTTP', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.31.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:192.168.1.1',
    '::ffff:c0a8:101',
  ])('blocks %s', (address) => expect(isPublicAddress(address)).toBe(false));

  it('rejects a hostname when DNS returns any private address', async () => {
    await expect(
      resolvePublicWebhook('https://hooks.example.com/callback', async () => [
        { address: '1.1.1.1', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ]),
    ).rejects.toThrow('WEBHOOK_ENDPOINT_FORBIDDEN');
  });

  it('rejects a response body larger than the fixed maximum', async () => {
    await expect(
      readBoundedWebhookBody(Readable.from([Buffer.alloc(65_537)])),
    ).rejects.toThrow('WEBHOOK_RESPONSE_TOO_LARGE');
  });
});
