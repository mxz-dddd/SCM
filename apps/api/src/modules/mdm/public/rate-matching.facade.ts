import { Inject, Injectable } from '@nestjs/common';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../../common/app-error';
import { isUuid } from '../../../common/validation';
import { PrismaService } from '../../../database/prisma.service';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const comparable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(comparable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${comparable(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
};

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

  async matchForBilling(
    input: {
      currency: string;
      dimensions: Readonly<Record<string, unknown>>;
      occurredAt: Date;
      organizationRef?: string;
      partyRef: string;
      routeRef?: string;
      serviceType: string;
    },
    context: TenantContext,
  ) {
    if (!isUuid(input.partyRef))
      throw new AppError('RATE_PARTNER_INVALID', 'partyRef is invalid', 400);
    const contracts = await this.prisma.contract.findMany({
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      take: 500,
      where: {
        effectiveFrom: { lte: input.occurredAt },
        effectiveUntil: { gt: input.occurredAt },
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    const cards = await this.prisma.rateCard.findMany({
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      where: {
        contractId: { in: contracts.map(({ id }) => id) },
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
    const contractById = new Map(contracts.map((item) => [item.id, item]));
    const cardById = new Map(cards.map((item) => [item.id, item]));
    const facts: Record<string, unknown> = {
      ...input.dimensions,
      currency: input.currency,
      ...(input.organizationRef
        ? { organizationRef: input.organizationRef }
        : {}),
      ...(input.routeRef
        ? { route: input.routeRef, routeRef: input.routeRef }
        : {}),
    };
    const candidates = versions.map((version) => {
      const card = cardById.get(version.rateCardId)!;
      const contract = contractById.get(card.contractId)!;
      const terms = record(contract.terms);
      const pricing = record(version.pricing);
      const exclusionReasons: string[] = [];
      if (contract.partnerId !== input.partyRef)
        exclusionReasons.push('PARTNER_MISMATCH');
      if (
        contract.currency !== input.currency ||
        version.currency !== input.currency
      )
        exclusionReasons.push('CURRENCY_MISMATCH');
      if (card.serviceType !== input.serviceType)
        exclusionReasons.push('SERVICE_TYPE_MISMATCH');
      if (
        terms.organizationRef !== undefined &&
        comparable(terms.organizationRef) !== comparable(input.organizationRef)
      )
        exclusionReasons.push('ORGANIZATION_MISMATCH');
      if (
        terms.routeRef !== undefined &&
        comparable(terms.routeRef) !== comparable(input.routeRef)
      )
        exclusionReasons.push('ROUTE_MISMATCH');
      for (const [key, value] of Object.entries(record(version.dimensions)))
        if (comparable(facts[key]) !== comparable(value))
          exclusionReasons.push(`DIMENSION_MISMATCH:${key}`);
      const priorityValue = pricing.priority ?? terms.priority ?? 0;
      const priority = Number.isFinite(Number(priorityValue))
        ? Math.trunc(Number(priorityValue))
        : 0;
      return {
        baseRate: version.baseRate.toString(),
        contractCode: contract.code,
        contractId: contract.id,
        currency: version.currency,
        dimensions: version.dimensions,
        eligible: exclusionReasons.length === 0,
        exclusionReasons,
        priority,
        rateCardCode: card.code,
        rateCardId: card.id,
        rateVersionId: version.id,
        serviceType: card.serviceType,
        versionNumber: version.versionNumber,
      };
    });
    const eligible = candidates
      .filter(({ eligible: itemEligible }) => itemEligible)
      .sort(
        (left, right) =>
          right.priority - left.priority ||
          right.versionNumber - left.versionNumber ||
          left.rateVersionId.localeCompare(right.rateVersionId),
      );
    return { candidates, selected: eligible[0] ?? null };
  }
}
