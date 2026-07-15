import type {
  OrderFulfillmentProcessStatus,
  OrderFulfillmentStepStatus,
} from '@prisma/client';
import { AppError } from '../../common/app-error';

const PROCESS_TRANSITIONS: Readonly<
  Record<
    OrderFulfillmentProcessStatus,
    readonly OrderFulfillmentProcessStatus[]
  >
> = {
  STARTED: ['WAITING_DOWNSTREAM'],
  WAITING_DOWNSTREAM: ['EXECUTING', 'FAILED', 'MANUAL_INTERVENTION'],
  EXECUTING: ['COMPLETED', 'FAILED', 'COMPENSATING', 'MANUAL_INTERVENTION'],
  COMPLETED: [],
  FAILED: ['WAITING_DOWNSTREAM', 'COMPENSATING', 'MANUAL_INTERVENTION'],
  COMPENSATING: ['FAILED', 'MANUAL_INTERVENTION'],
  MANUAL_INTERVENTION: ['WAITING_DOWNSTREAM', 'COMPENSATING'],
};

const STEP_TRANSITIONS: Readonly<
  Record<OrderFulfillmentStepStatus, readonly OrderFulfillmentStepStatus[]>
> = {
  PENDING: ['PROCESSING', 'SUCCEEDED', 'FAILED', 'MANUAL'],
  PROCESSING: ['SUCCEEDED', 'FAILED', 'MANUAL'],
  SUCCEEDED: ['COMPENSATING', 'MANUAL'],
  FAILED: ['PENDING', 'COMPENSATING', 'MANUAL'],
  COMPENSATING: ['COMPENSATED', 'FAILED', 'MANUAL'],
  COMPENSATED: [],
  MANUAL: ['PENDING', 'COMPENSATING'],
};

export function assertProcessTransition(
  current: OrderFulfillmentProcessStatus,
  target: OrderFulfillmentProcessStatus,
) {
  if (!PROCESS_TRANSITIONS[current].includes(target))
    throw new AppError(
      'FULFILLMENT_PROCESS_TRANSITION_INVALID',
      `Fulfillment process transition ${current} -> ${target} is not allowed`,
      409,
    );
}

export function assertProcessStepTransition(
  current: OrderFulfillmentStepStatus,
  target: OrderFulfillmentStepStatus,
) {
  if (!STEP_TRANSITIONS[current].includes(target))
    throw new AppError(
      'FULFILLMENT_STEP_TRANSITION_INVALID',
      `Fulfillment step transition ${current} -> ${target} is not allowed`,
      409,
    );
}
