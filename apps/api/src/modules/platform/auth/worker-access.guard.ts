import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../../../common/app-error';
import type { TenantRequest } from './tenant-context.middleware';
import {
  WORKER_OPERATION,
  WORKER_OPERATIONS,
  type WorkerOperation,
} from './worker-access.decorator';

const allowed = new Set<WorkerOperation>(WORKER_OPERATIONS);

@Injectable()
export class WorkerAccessGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    if (request.tenantContext?.accountKind !== 'WORKER') return true;
    const operation = this.reflector.getAllAndOverride<WorkerOperation>(
      WORKER_OPERATION,
      [context.getHandler(), context.getClass()],
    );
    if (!operation || !allowed.has(operation))
      throw new AppError(
        'WORKER_OPERATION_FORBIDDEN',
        'Worker identity cannot access this operation',
        403,
      );
    request.workerOperation = operation;
    return true;
  }
}
