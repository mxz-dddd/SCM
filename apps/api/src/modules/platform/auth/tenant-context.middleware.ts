import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { TenantContext } from '@scm/shared';
import type { NextFunction, Request, Response } from 'express';
import { SessionContextService } from './session-context.service';

export interface TenantRequest extends Request {
  tenantContext: TenantContext;
}

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(
    @Inject(SessionContextService)
    private readonly sessions: SessionContextService,
  ) {}

  async use(request: Request, _response: Response, next: NextFunction) {
    const context = await this.sessions.authenticate(
      request.header('Authorization'),
      request.header('X-Tenant-Id'),
    );
    (request as TenantRequest).tenantContext = context;
    next();
  }
}
