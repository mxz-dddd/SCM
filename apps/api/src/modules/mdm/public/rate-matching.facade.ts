import { Inject, Injectable } from '@nestjs/common';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../../common/app-error';
import { isUuid } from '../../../common/validation';
import { PrismaService } from '../../../database/prisma.service';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

@Injectable()
export class RateMatchingFacade {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listActiveSources(context: TenantContext) {
    const contracts = await this.prisma.contract.findMany({
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      where: { status: 'ACTIVE', tenantId: context.tenantId },
    });
    const cards = await this.prisma.rateCard.findMany({
      where: {
        contractId: { in: contracts.map(({ id }) => id) },
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    const versions = await this.prisma.rateVersion.findMany({
      orderBy: [{ versionNumber: 'desc' }, { id: 'asc' }],
      where: {
        rateCardId: { in: cards.map(({ id }) => id) },
        status: 'PUBLISHED',
        tenantId: context.tenantId,
      },
    });
    const contractById = new Map(contracts.map((item) => [item.id, item]));
    const cardById = new Map(cards.map((item) => [item.id, item]));
    return versions.map((version) => {
      const card = cardById.get(version.rateCardId)!;
      const contract = contractById.get(card.contractId)!;
      return {
        contractCode: contract.code,
        contractId: contract.id,
        dimensions: version.dimensions,
        effectiveFrom: version.effectiveFrom,
        effectiveUntil: version.effectiveUntil,
        partnerId: contract.partnerId,
        rateCardCode: card.code,
        rateVersionId: version.id,
        status: version.status,
        serviceType: card.serviceType,
        versionNumber: version.versionNumber,
      };
    });
  }

  async match(
    input: {
      contractId: string;
      dimensions: Readonly<Record<string, unknown>>;
      occurredAt: Date;
      serviceType: string;
    },
    context: TenantContext,
  ) {
    if (!isUuid(input.contractId))
      throw new AppError('RATE_CONTRACT_INVALID', 'contractId is invalid', 400);
    const contract = await this.prisma.contract.findFirst({
      where: {
        effectiveFrom: { lte: input.occurredAt },
        effectiveUntil: { gt: input.occurredAt },
        id: input.contractId,
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    if (!contract) return [];
    const cards = await this.prisma.rateCard.findMany({
      where: {
        contractId: contract.id,
        serviceType: input.serviceType.trim().toUpperCase(),
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    const versions = await this.prisma.rateVersion.findMany({
      orderBy: [{ versionNumber: 'desc' }, { id: 'asc' }],
      where: {
        effectiveFrom: { lte: input.occurredAt },
        effectiveUntil: { gt: input.occurredAt },
        rateCardId: { in: cards.map(({ id }) => id) },
        status: 'PUBLISHED',
        tenantId: context.tenantId,
      },
    });
    return versions
      .filter((version) =>
        Object.entries(record(version.dimensions)).every(
          ([key, value]) =>
            JSON.stringify(input.dimensions[key]) === JSON.stringify(value),
        ),
      )
      .map((version) => ({
        baseRate: version.baseRate.toString(),
        contractId: contract.id,
        contractSnapshot: {
          code: contract.code,
          currency: contract.currency,
          partnerId: contract.partnerId,
        },
        currency: version.currency,
        dimensions: version.dimensions,
        pricing: version.pricing,
        rateCardId: version.rateCardId,
        rateVersionId: version.id,
        versionNumber: version.versionNumber,
      }));
  }
}
