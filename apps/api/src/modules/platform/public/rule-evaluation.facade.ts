import { Inject, Injectable } from '@nestjs/common';
import type { TenantContext } from '@scm/shared';
import type { CommandMetadata } from '../tenant.service';
import {
  RuleEngineService,
  type EvaluateRuleInput,
} from '../rule-engine.service';

@Injectable()
export class RuleEvaluationFacade {
  constructor(
    @Inject(RuleEngineService) private readonly rules: RuleEngineService,
  ) {}

  evaluateAllocation(
    input: Omit<EvaluateRuleInput, 'scenario'>,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.rules.evaluate(
      'EXECUTION',
      { ...input, scenario: 'ALLOCATION' },
      context,
      metadata,
    );
  }

  evaluatePutaway(
    input: Omit<EvaluateRuleInput, 'scenario'>,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.rules.evaluate(
      'EXECUTION',
      { ...input, scenario: 'PUTAWAY' },
      context,
      metadata,
    );
  }
}
