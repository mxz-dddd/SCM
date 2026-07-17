import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../../../common/app-error';
import type { TenantRequest } from './tenant-context.middleware';
import { REQUIRED_PERMISSION } from './permission.decorator';
import { PermissionService } from './permission.service';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PermissionService)
    private readonly permissions: PermissionService,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const permissionCode = this.reflector.getAllAndOverride<string>(
      REQUIRED_PERMISSION,
      [executionContext.getHandler(), executionContext.getClass()],
    );
    if (!permissionCode) return true;

    const request = executionContext.switchToHttp().getRequest<TenantRequest>();
    if (request.tenantContext.accountKind === 'WORKER')
      return Boolean(request.workerOperation);
    const organizationId = request.header('X-Organization-Id') ?? undefined;
    const resolution = await this.permissions.decide({
      context: request.tenantContext,
      correlationId: request.header('X-Correlation-Id') ?? 'missing',
      ...(organizationId ? { organizationId } : {}),
      permissionCode,
      resourceRef: request.originalUrl,
    });
    if (!resolution.allowed) {
      throw new AppError(
        'AUTH_PERMISSION_DENIED',
        'The current account is not allowed to perform this action',
        403,
      );
    }
    return true;
  }
}
