import { describe, expect, it } from 'vitest';
import {
  isPublicWebhookAddress,
  WebhookEndpointPolicy,
} from './webhook-endpoint.policy';

describe('WebhookEndpointPolicy', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.1.2.3',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '::ffff:10.0.0.1',
    '::ffff:c0a8:101',
  ])('rejects non-public address %s', (address) => {
    expect(isPublicWebhookAddress(address)).toBe(false);
  });

  it('rejects unsafe schemes, userinfo, metadata hostnames and private DNS answers', async () => {
    const privateDns = new WebhookEndpointPolicy(async () => [
      { address: '10.0.0.5', family: 4 },
    ]);
    await expect(
      privateDns.validate('https://hooks.example.com/path'),
    ).rejects.toMatchObject({
      code: 'WEBHOOK_ENDPOINT_FORBIDDEN',
    });
    await expect(
      privateDns.validate('http://hooks.example.com/path'),
    ).rejects.toBeDefined();
    await expect(
      privateDns.validate('https://user:pass@hooks.example.com/path'),
    ).rejects.toBeDefined();
    await expect(
      privateDns.validate('https://metadata.google.internal/latest'),
    ).rejects.toBeDefined();
    await expect(
      privateDns.validate('https://169.254.169.254/latest'),
    ).rejects.toBeDefined();
  });

  it('normalizes and accepts a hostname only when every DNS answer is public', async () => {
    const policy = new WebhookEndpointPolicy(async () => [
      { address: '1.1.1.1', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
    await expect(
      policy.validate('https://HOOKS.EXAMPLE.COM:443/callback'),
    ).resolves.toMatchObject({
      url: 'https://hooks.example.com/callback',
    });
  });
});
