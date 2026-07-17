import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../../database/prisma.service';
import { SessionContextService } from './session-context.service';
import type { TenantRequest } from './tenant-context.middleware';
import { WorkerAccessible } from './worker-access.decorator';

@Controller('api/v1/internal/worker')
export class WorkerController {
  constructor(
    @Inject(SessionContextService)
    private readonly sessions: SessionContextService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get('tenants')
  tenants(
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() request: Request,
  ) {
    return this.sessions.discoverActiveTenants(
      request.header('Authorization'),
      { ...(cursor ? { cursor } : {}), ...(limit ? { limit } : {}) },
    );
  }

  @Get('backlog')
  @WorkerAccessible('WORKER_BACKLOG_READ')
  async backlog(@Req() request: TenantRequest) {
    const tenantId = request.tenantContext.tenantId;
    const [outbox, eventDeliveries, webhooks, jobs, printJobs] =
      await Promise.all([
        this.prisma.platformOutbox.count({
          where: {
            status: { in: ['PENDING', 'FAILED', 'PROCESSING'] },
            tenantId,
          },
        }),
        this.prisma.eventDelivery.count({
          where: {
            status: { in: ['PENDING', 'FAILED', 'PROCESSING'] },
            tenantId,
          },
        }),
        this.prisma.integrationDeliveryAttempt.count({
          where: {
            status: { in: ['PENDING', 'FAILED', 'PROCESSING', 'RETRY_WAIT'] },
            tenantId,
          },
        }),
        this.prisma.jobRun.count({
          where: {
            status: { in: ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'] },
            tenantId,
          },
        }),
        this.prisma.printJob.count({
          where: { status: { in: ['QUEUED', 'PRINTING'] }, tenantId },
        }),
      ]);
    return { eventDeliveries, jobs, outbox, printJobs, webhooks };
  }
}
