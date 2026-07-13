import { describe, expect, it } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports a healthy API scaffold', () => {
    expect(new HealthController().getHealth()).toEqual({
      service: 'api',
      status: 'ok',
    });
  });
});
