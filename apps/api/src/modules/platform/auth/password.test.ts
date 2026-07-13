import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('local password authentication', () => {
  it('authenticates the original password without storing it', async () => {
    const encoded = await hashPassword('correct-horse-battery-staple');

    expect(encoded).not.toContain('correct-horse-battery-staple');
    await expect(
      verifyPassword('correct-horse-battery-staple', encoded),
    ).resolves.toBe(true);
    await expect(verifyPassword('incorrect-password', encoded)).resolves.toBe(
      false,
    );
  });

  it('rejects weak and malformed values', async () => {
    await expect(hashPassword('too-short')).rejects.toThrow('at least 12');
    await expect(verifyPassword('anything', 'not-a-hash')).resolves.toBe(false);
  });
});
