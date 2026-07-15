import { describe, expect, it } from 'vitest';
import {
  assertOpsTransition,
  OPS_STATE_TRANSITIONS,
} from './operations.service';

describe('operations aggregate state machines', () => {
  it('accepts every declared transition and rejects undeclared and terminal transitions', () => {
    for (const [machine, states] of Object.entries(OPS_STATE_TRANSITIONS)) {
      for (const [current, targets] of Object.entries(states)) {
        for (const target of targets)
          expect(() =>
            assertOpsTransition(machine, current, target),
          ).not.toThrow();
        const undeclared = Object.keys(states).find(
          (candidate) => candidate !== current && !targets.includes(candidate),
        );
        if (undeclared)
          expect(() =>
            assertOpsTransition(machine, current, undeclared),
          ).toThrowError(
            expect.objectContaining({ code: 'OPS_TRANSITION_INVALID' }),
          );
      }
    }
  });
});
