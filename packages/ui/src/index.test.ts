import { describe, expect, it } from 'vitest';
import { UI_PACKAGE_STATUS } from './index';

describe('UI package scaffold', () => {
  it('exposes its readiness marker', () => {
    expect(UI_PACKAGE_STATUS).toBe('scaffold-ready');
  });
});
