import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  EVENT_SUBSCRIPTIONS,
  INTERNAL_EVENT_ENDPOINT_ALLOWLIST,
  eventMatchesPattern,
  subscriptionsForEvent,
} from '@scm/shared';
import { describe, expect, it } from 'vitest';

describe('V2 event subscription catalog', () => {
  it('keeps consumers unique and endpoints on the internal allowlist', () => {
    const consumers = EVENT_SUBSCRIPTIONS.map((item) => item.consumer);
    expect(new Set(consumers).size).toBe(consumers.length);
    for (const subscription of EVENT_SUBSCRIPTIONS) {
      expect(subscription.endpoint).toMatch(/^\/api\/v1\//);
      expect(INTERNAL_EVENT_ENDPOINT_ALLOWLIST.has(subscription.endpoint)).toBe(
        true,
      );
      expect(subscription.eventPatterns.length).toBeGreaterThan(0);
      expect(subscription.maxAttempts).toBeGreaterThan(0);
      expect(subscription.baseDelaySeconds).toBeGreaterThan(0);
    }
  });

  it('matches exact and wildcard event patterns without prefix leakage', () => {
    expect(eventMatchesPattern('outbound.shipped.v1', 'outbound.*')).toBe(true);
    expect(eventMatchesPattern('outbound.shipped.v1', 'inbound.*')).toBe(false);
    expect(
      subscriptionsForEvent('fulfillment.released.v2').map(
        (item) => item.consumer,
      ),
    ).toContain('wms.fulfillment-command.v2');
  });

  it('keeps the generated design catalog synchronized with code', () => {
    const root = resolve(process.cwd(), '../..');
    expect(() =>
      execFileSync('pnpm', ['event:catalog', '--check'], {
        cwd: root,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});
