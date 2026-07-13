import type { AccountKind, TenantContext } from '@scm/shared';
import { AppError } from '../../../common/app-error';

export function requireAccountKind(
  context: TenantContext,
  allowed: readonly AccountKind[],
): void {
  if (!allowed.includes(context.accountKind)) {
    throw new AppError(
      'AUTH_PERMISSION_DENIED',
      'The current account is not allowed to perform this action',
      403,
    );
  }
}
