import { Inject, Injectable } from '@nestjs/common';
import type { TenantContext } from '@scm/shared';
import { PermissionService } from '../auth/permission.service';

@Injectable()
export class PermissionDecisionFacade {
  constructor(
    @Inject(PermissionService) private readonly permissions: PermissionService,
  ) {}

  decideOrder(
    permissionCode: string,
    orderId: string,
    context: TenantContext,
    correlationId: string,
  ) {
    return this.permissions.decide({
      context,
      correlationId,
      permissionCode,
      resourceRef: `/api/v1/oms/orders/${orderId}`,
    });
  }
}
