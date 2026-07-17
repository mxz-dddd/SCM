import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ExternalGatewayGuard } from './external-gateway.guard';

const context = (request: Record<string, unknown>) =>
  ({
    getClass: () => class TestController {},
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

describe('ExternalGatewayGuard', () => {
  it('derives method, normalized path, bytes, body hash and IP from the real request', async () => {
    const authorize = vi.fn().mockResolvedValue({ allowed: true });
    const guard = new ExternalGatewayGuard(
      { getAllAndOverride: vi.fn() } as never,
      { authorize } as never,
    );
    const request = {
      baseUrl: '',
      body: { deviceCode: 'D-1' },
      header: (name: string) =>
        ({
          'content-length': '4',
          'x-correlation-id': 'corr-1',
          'x-scm-api-secret': 'secret',
          'x-scm-key-id': 'key-1',
          'x-scm-method': 'DELETE',
          'x-scm-route': '/api/v1/external/forged',
        })[name.toLowerCase()],
      ip: '203.0.113.9',
      method: 'POST',
      originalUrl: '/api/v1/external/iot/heartbeat?forged=1',
      path: '/api/v1/external/iot/heartbeat',
      rawBody: Buffer.from('{"deviceCode":"D-1"}'),
      socket: {},
    };
    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        ipAddress: '203.0.113.9',
        method: 'POST',
        requestBytes: request.rawBody.length,
        route: '/api/v1/external/iot/heartbeat',
        type: 'API_KEY',
      }),
    );
    expect(authorize.mock.calls[0]![0].bodyHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects an external request without a derived credential', async () => {
    const guard = new ExternalGatewayGuard(
      { getAllAndOverride: vi.fn() } as never,
      { authorize: vi.fn() } as never,
    );
    await expect(
      guard.canActivate(
        context({
          body: {},
          header: () => undefined,
          method: 'POST',
          originalUrl: '/api/v1/external/iot/heartbeat',
          path: '/api/v1/external/iot/heartbeat',
          socket: {},
        }),
      ),
    ).rejects.toMatchObject({
      code: 'GATEWAY_CREDENTIAL_REQUIRED',
      statusCode: 401,
    });
  });
});
