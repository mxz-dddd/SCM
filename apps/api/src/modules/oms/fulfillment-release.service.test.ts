import { describe, expect, it } from 'vitest';
import { assertFulfillmentTransition } from './fulfillment-release.service';
describe('fulfillment state machine', () => {
  it('accepts its independent main path', () => {
    expect(() => assertFulfillmentTransition('DRAFT', 'RELEASED')).not.toThrow();
    expect(() => assertFulfillmentTransition('RELEASED', 'ACCEPTED')).not.toThrow();
    expect(() => assertFulfillmentTransition('ACCEPTED', 'EXECUTING')).not.toThrow();
    expect(() => assertFulfillmentTransition('EXECUTING', 'COMPLETED')).not.toThrow();
  });
  it('rejects skipped and reversed transitions', () => {
    expect(() => assertFulfillmentTransition('RELEASED', 'COMPLETED')).toThrowError(expect.objectContaining({ code: 'FULFILLMENT_TRANSITION_INVALID' }));
    expect(() => assertFulfillmentTransition('COMPLETED', 'EXECUTING')).toThrowError(expect.objectContaining({ code: 'FULFILLMENT_TRANSITION_INVALID' }));
  });
});
