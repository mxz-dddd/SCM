import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/app-error';
import { PrismaService } from '../../../database/prisma.service';

export interface RateLimitInput {
  readonly actorId: string;
  readonly limit: number;
  readonly route: string;
  readonly scope: 'API' | 'LOGIN';
  readonly subject: string;
  readonly tenantId: string;
}

@Injectable()
export class RateLimitService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async consume(input: RateLimitInput): Promise<number> {
    const bucketStart = new Date();
    bucketStart.setUTCSeconds(0, 0);
    const subjectHash = createHash('sha256')
      .update(input.subject)
      .digest('hex');
    const bucket = await this.prisma.platformRateLimitBucket.upsert({
      create: {
        bucketStart,
        createdBy: input.actorId,
        requestCount: 1,
        route: input.route,
        scope: input.scope,
        subjectHash,
        tenantId: input.tenantId,
        updatedBy: input.actorId,
      },
      update: {
        requestCount: { increment: 1 },
        updatedBy: input.actorId,
        version: { increment: 1 },
      },
      where: {
        tenantId_scope_subjectHash_route_bucketStart: {
          bucketStart,
          route: input.route,
          scope: input.scope,
          subjectHash,
          tenantId: input.tenantId,
        },
      },
    });
    if (bucket.requestCount > input.limit)
      throw new AppError(
        `${input.scope}_RATE_LIMIT_EXCEEDED`,
        'Request rate limit exceeded',
        429,
        { retryable: true },
      );
    return bucket.requestCount;
  }
}
