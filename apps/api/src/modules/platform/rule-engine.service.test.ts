import { describe, expect, it } from 'vitest';
import type { TenantContext } from '@scm/shared';
import {
  RuleEngineService,
  evaluateRuleSet,
  validateRuleSet,
} from './rule-engine.service';

const rules = [
  {
    code: 'BLOCK_CAPACITY',
    conditions: [
      {
        field: 'capacity',
        operator: 'LT' as const,
        source: 'CANDIDATE' as const,
        value: 100,
      },
    ],
    id: 'rule-block',
    name: 'Block insufficient capacity',
    priority: 10,
    result: { effect: 'EXCLUDE' as const, reason: 'CAPACITY_INSUFFICIENT' },
  },
  {
    code: 'PREFERRED_REGION',
    conditions: [
      {
        field: 'region',
        operator: 'EQ' as const,
        source: 'CANDIDATE' as const,
        value: 'EAST',
      },
      {
        field: 'urgent',
        operator: 'EQ' as const,
        source: 'INPUT' as const,
        value: true,
      },
    ],
    id: 'rule-score',
    name: 'Prefer region',
    priority: 20,
    result: {
      effect: 'INCLUDE' as const,
      score: 50,
      values: { service: 'EXPRESS' },
    },
  },
  {
    code: 'DECISION_VALUE',
    conditions: [
      {
        field: 'urgent',
        operator: 'EQ' as const,
        source: 'INPUT' as const,
        value: true,
      },
    ],
    id: 'rule-value',
    name: 'Set decision',
    priority: 30,
    result: { effect: 'DECIDE' as const, values: { strategy: 'URGENT' } },
  },
];

describe('priority rule evaluation and trace explanation', () => {
  it('excludes hard failures, ranks matches and returns rule values', () => {
    const result = evaluateRuleSet(rules, { urgent: true }, [
      { capacity: 50, id: 'low', region: 'EAST' },
      { capacity: 200, id: 'west', region: 'WEST' },
      { capacity: 200, id: 'east', region: 'EAST' },
    ]);
    expect(result.decision.selectedCandidateId).toBe('east');
    expect(result.decision.values).toEqual({ strategy: 'URGENT' });
    expect(result.exclusions).toEqual([
      {
        candidateId: 'low',
        reason: 'CAPACITY_INSUFFICIENT',
        ruleId: 'rule-block',
      },
    ]);
    expect(result.matchedRuleIds).toEqual([
      'rule-block',
      'rule-score',
      'rule-value',
    ]);
  });

  it('returns NO_MATCH with stable candidate ordering when no rule matches', () => {
    const result = evaluateRuleSet(rules, { urgent: false }, [
      { capacity: 200, id: 'b', region: 'WEST' },
      { capacity: 200, id: 'a', region: 'WEST' },
    ]);
    expect(result.outcome).toBe('NO_MATCH');
    expect(result.decision.candidates.map(({ id }) => id)).toEqual(['a', 'b']);
  });

  it('rejects unrecognized operators and duplicate rule codes', () => {
    expect(() => validateRuleSet(rules)).not.toThrow();
    expect(() =>
      validateRuleSet([rules[0]!, { ...rules[0]!, id: 'other' }]),
    ).toThrow(/invalid/);
    expect(() =>
      validateRuleSet([
        {
          ...rules[0]!,
          conditions: [
            {
              field: 'x',
              operator: 'SCRIPT' as never,
              source: 'INPUT' as const,
            },
          ],
        },
      ]),
    ).toThrow(/invalid/);
  });

  it('rejects an invalid scenario before persistence or evaluation', () => {
    const context: TenantContext = {
      accountId: '10000000-0000-4000-8000-000000000001',
      accountKind: 'USER',
      deviceId: 'test',
      organizationIds: [],
      permissionVersion: 1,
      tenantId: '10000000-0000-4000-8000-000000000002',
      tokenId: 'token',
    };
    const service = new RuleEngineService({} as never, {} as never);
    expect(() =>
      service.evaluate(
        'SIMULATION',
        { candidates: [], facts: {}, scenario: 'UNKNOWN' },
        context,
        {
          correlationId: 'correlation',
          idempotencyKey: 'key',
          ipAddress: '127.0.0.1',
        },
      ),
    ).toThrow(/scenario|invalid/i);
  });
});
