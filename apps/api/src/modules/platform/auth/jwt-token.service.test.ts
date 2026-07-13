import { describe, expect, it } from 'vitest';
import { JwtTokenService } from './jwt-token.service';

const service = new JwtTokenService({
  JWT_SECRET: 'test-only-secret-with-at-least-32-characters',
});

const input = {
  accountKind: 'TENANT_ADMIN' as const,
  deviceId: 'browser-1',
  organizationIds: ['10000000-0000-4000-8000-000000000010'],
  permissionVersion: 7,
  subject: '10000000-0000-4000-8000-000000000011',
  tenantId: '10000000-0000-4000-8000-000000000012',
};

describe('JWT session tokens', () => {
  it('round-trips tenant, organization, device and permission version claims', () => {
    const issued = service.issue(input, { now: 1000, ttlSeconds: 300 });

    expect(service.verify(issued.accessToken, 1001)).toMatchObject({
      accountKind: 'TENANT_ADMIN',
      deviceId: 'browser-1',
      expiresAt: 1300,
      issuedAt: 1000,
      organizationIds: input.organizationIds,
      permissionVersion: 7,
      subject: input.subject,
      tenantId: input.tenantId,
    });
  });

  it('rejects tampered and expired tokens', () => {
    const issued = service.issue(input, { now: 1000, ttlSeconds: 10 });
    const tampered = `${issued.accessToken.slice(0, -1)}x`;

    expect(() => service.verify(tampered, 1001)).toThrow(
      'Authentication token is invalid',
    );
    expect(() => service.verify(issued.accessToken, 1010)).toThrow(
      'Authentication token is invalid',
    );
  });
});
