import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { TenantRequest } from './tenant-context.middleware';
import { RateLimitService } from './rate-limit.service';

const positive = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

@Injectable()
export class ApiRateLimitGuard implements CanActivate {
  constructor(
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const tenant = request.tenantContext;
    if (
      !tenant ||
      tenant.accountKind === 'WORKER' ||
      request.path.startsWith('/api/v1/external/')
    )
      return true;
    const route =
      `${request.baseUrl}${request.route?.path ?? request.path}`.slice(0, 300);
    await this.limits.consume({
      actorId: tenant.accountId,
      limit: positive(process.env.API_RATE_LIMIT_PER_MINUTE, 600),
      route,
      scope: 'API',
      subject: `${tenant.tenantId}:${tenant.accountId}:${route}`,
      tenantId: tenant.tenantId,
    });
    return true;
  }
}
