import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENCY_SCOPE = 'scm.idempotency-scope';

export const Idempotent = (scope: string) => SetMetadata(IDEMPOTENCY_SCOPE, scope);
