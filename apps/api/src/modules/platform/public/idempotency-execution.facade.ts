import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IdempotencyService } from '../idempotency.service';

@Injectable()
export class IdempotencyExecutionFacade {
  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  execute<T extends Record<string, unknown>>(
    input: {
      readonly actorId: string;
      readonly key: string | undefined;
      readonly payload: unknown;
      readonly responseCode: number;
      readonly scope: string;
      readonly tenantId: string;
    },
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.idempotency.execute(input, operation);
  }
}
