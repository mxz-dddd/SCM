import { describe, expect, it } from 'vitest';
import { deriveCredentialSecret } from './service-account.service';

describe('API credential secret handling', () => {
  it('derives a stable replayable secret without storing plaintext', () => {
    const masterKey = 'test-only-master-key-with-at-least-32-characters';
    const first = deriveCredentialSecret(masterKey, 'tenant-1', 'request-1');
    const replay = deriveCredentialSecret(masterKey, 'tenant-1', 'request-1');

    expect(replay).toBe(first);
    expect(first).toMatch(/^scm_/);
    expect(deriveCredentialSecret(masterKey, 'tenant-1', 'request-2')).not.toBe(
      first,
    );
  });
});
