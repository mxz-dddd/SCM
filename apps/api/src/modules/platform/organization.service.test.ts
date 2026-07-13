import { describe, expect, it } from 'vitest';
import { wouldCreateOrganizationCycle } from './organization.service';

describe('organization move cycle validation', () => {
  const parents = new Map<string, string | null>([
    ['root', null],
    ['business', 'root'],
    ['warehouse', 'business'],
  ]);

  it('allows moving a node to a different ancestor branch', () => {
    expect(wouldCreateOrganizationCycle(parents, 'warehouse', 'root')).toBe(
      false,
    );
  });

  it('rejects moving a node under itself or a descendant', () => {
    expect(wouldCreateOrganizationCycle(parents, 'business', 'business')).toBe(
      true,
    );
    expect(wouldCreateOrganizationCycle(parents, 'business', 'warehouse')).toBe(
      true,
    );
  });
});
