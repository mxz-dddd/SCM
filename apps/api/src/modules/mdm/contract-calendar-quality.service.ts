import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type CalendarStatus,
  type ContractStatus,
  type QualityAssessmentStatus,
  type RateVersionStatus,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isPrismaErrorCode } from '../../common/prisma-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { IdempotencyService } from '../platform/idempotency.service';
import type { CommandMetadata } from '../platform/tenant.service';

export interface VersionInput {
  readonly expectedVersion: number;
}
export interface SaveContractInput {
  readonly code: string;
  readonly contractType: string;
  readonly currency: string;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string;
  readonly name: string;
  readonly partnerId: string;
  readonly terms?: Readonly<Record<string, unknown>>;
}
export interface ApprovalSubmitInput extends VersionInput {
  readonly approvalInstanceId: string;
}
export interface ApprovalDecisionInput extends VersionInput {
  readonly approved: boolean;
  readonly approvalInstanceId: string;
}
export interface SaveRateCardInput {
  readonly code: string;
  readonly contractId: string;
  readonly name: string;
  readonly serviceType: string;
}
export interface SaveRateVersionInput {
  readonly baseRate: string;
  readonly currency: string;
  readonly dimensions: Readonly<Record<string, unknown>>;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string;
  readonly pricing?: Readonly<Record<string, unknown>>;
  readonly rateCardId: string;
}
export interface SaveCalendarInput {
  readonly code: string;
  readonly effectiveFrom: string;
  readonly effectiveUntil?: string;
  readonly name: string;
  readonly timeZone: string;
  readonly workingDays: readonly number[];
}
export interface SaveCalendarDateInput {
  readonly calendarId: string;
  readonly date: string;
  readonly reason?: string;
  readonly working: boolean;
}
export interface SaveShiftInput {
  readonly calendarId: string;
  readonly code: string;
  readonly endTime: string;
  readonly name: string;
  readonly startTime: string;
}
export interface SaveWorkingWindowInput {
  readonly calendarId: string;
  readonly cutoffTime?: string;
  readonly leadTimeMinutes?: number;
  readonly resourceId: string;
  readonly resourceType: string;
  readonly serviceType?: string;
  readonly shiftId?: string;
}
export interface EvaluateCalendarInput {
  readonly calendarCode: string;
  readonly date: string;
  readonly localTime?: string;
}
export interface QualityIssueInput {
  readonly code: string;
  readonly dimension: string;
  readonly message: string;
  readonly severity: 'ERROR' | 'INFO' | 'WARNING';
}
export interface AssessQualityInput {
  readonly dimensions: Readonly<Record<string, number>>;
  readonly issues?: readonly QualityIssueInput[];
  readonly objectId: string;
  readonly objectType:
    | 'DRIVER'
    | 'EQUIPMENT_TYPE'
    | 'PARTNER'
    | 'PRODUCT'
    | 'VEHICLE'
    | 'WAREHOUSE';
  readonly threshold?: number;
}
export interface ResolveIssueInput extends VersionInput {
  readonly resolution: string;
  readonly targetStatus: 'RESOLVED' | 'WAIVED';
}

const CODE = /^[A-Z0-9][A-Z0-9_.-]{0,99}$/;
const CURRENCY = /^[A-Z]{3}$/;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function assertContractTransition(
  current: ContractStatus,
  target: ContractStatus,
): void {
  const allowed =
    (current === 'DRAFT' && target === 'PENDING_APPROVAL') ||
    (current === 'PENDING_APPROVAL' &&
      ['ACTIVE', 'REJECTED'].includes(target)) ||
    (current === 'ACTIVE' &&
      ['SUSPENDED', 'EXPIRED', 'INACTIVE'].includes(target)) ||
    (current === 'SUSPENDED' &&
      ['ACTIVE', 'EXPIRED', 'INACTIVE'].includes(target));
  if (!allowed)
    throw new AppError(
      'CONTRACT_TRANSITION_INVALID',
      `Contract transition ${current} -> ${target} is not allowed`,
      409,
    );
}
export function assertRateTransition(
  current: RateVersionStatus,
  target: RateVersionStatus,
): void {
  if (!(
    (current === 'DRAFT' && target === 'PUBLISHED') ||
    (current === 'PUBLISHED' && target === 'RETIRED')
  ))
    throw new AppError(
      'RATE_VERSION_TRANSITION_INVALID',
      `Rate transition ${current} -> ${target} is not allowed`,
      409,
    );
}
export function assertCalendarTransition(
  current: CalendarStatus,
  target: CalendarStatus,
): void {
  if (!(
    (current === 'DRAFT' && target === 'ACTIVE') ||
    (current === 'ACTIVE' && target === 'INACTIVE')
  ))
    throw new AppError(
      'CALENDAR_TRANSITION_INVALID',
      `Calendar transition ${current} -> ${target} is not allowed`,
      409,
    );
}
export function assertQualityTransition(
  current: QualityAssessmentStatus,
  target: QualityAssessmentStatus,
): void {
  if (!(
    (current === 'DRAFT' && target === 'PENDING_APPROVAL') ||
    (current === 'PENDING_APPROVAL' &&
      ['APPROVED', 'REJECTED'].includes(target))
  ))
    throw new AppError(
      'QUALITY_TRANSITION_INVALID',
      `Quality transition ${current} -> ${target} is not allowed`,
      409,
    );
}
function required(value: string | undefined, field: string, max: number) {
  const result = value?.trim();
  if (!result || result.length > max)
    throw new AppError('MDM_INPUT_INVALID', `${field} is required`, 400);
  return result;
}
function iso(value: string, field: string) {
  const result = new Date(value);
  if (Number.isNaN(result.getTime()))
    throw new AppError('MDM_DATE_INVALID', `${field} is invalid`, 400);
  return result;
}
function day(value: string, field: string) {
  if (!DATE.test(value))
    throw new AppError('MDM_DATE_INVALID', `${field} must use YYYY-MM-DD`, 400);
  return iso(`${value}T00:00:00.000Z`, field);
}
function money(value: string) {
  try {
    const result = new Prisma.Decimal(value);
    if (!result.isFinite() || result.isNegative()) throw new Error();
    return result;
  } catch {
    throw new AppError(
      'RATE_AMOUNT_INVALID',
      'baseRate must be a non-negative decimal',
      400,
    );
  }
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
function json(value?: Readonly<Record<string, unknown>>) {
  return (value ?? {}) as Prisma.InputJsonObject;
}

@Injectable()
export class ContractCalendarQualityService {
  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}
  async listQuality(context: TenantContext) {
    const assessments = await this.prisma.dataQualityAssessment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 300,
      where: { tenantId: context.tenantId },
    });
    const issues = await this.prisma.dataQualityIssue.findMany({
      orderBy: { createdAt: 'asc' },
      where: {
        assessmentId: { in: assessments.map(({ id }) => id) },
        tenantId: context.tenantId,
      },
    });
    return assessments.map((assessment) => ({
      ...assessment,
      issues: issues.filter(
        ({ assessmentId }) => assessmentId === assessment.id,
      ),
    }));
  }
  listContracts(context: TenantContext) {
    return this.prisma.contract.findMany({
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      take: 500,
      where: { tenantId: context.tenantId },
    });
  }
  async getContract(id: string, context: TenantContext) {
    this.uuid(id, 'CONTRACT_NOT_FOUND');
    const contract = await this.prisma.contract.findFirst({
      where: { id, tenantId: context.tenantId },
    });
    if (!contract)
      throw new AppError('CONTRACT_NOT_FOUND', 'Contract was not found', 404);
    const cards = await this.prisma.rateCard.findMany({
      orderBy: { code: 'asc' },
      where: { contractId: id, tenantId: context.tenantId },
    });
    const versions = await this.prisma.rateVersion.findMany({
      orderBy: [{ rateCardId: 'asc' }, { versionNumber: 'desc' }],
      where: {
        rateCardId: { in: cards.map(({ id: cardId }) => cardId) },
        tenantId: context.tenantId,
      },
    });
    return { ...contract, cards, versions };
  }
  createContract(
    input: SaveContractInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const code = required(input.code, 'code', 100).toUpperCase();
    const from = iso(input.effectiveFrom, 'effectiveFrom');
    const until = iso(input.effectiveUntil, 'effectiveUntil');
    const currency = required(input.currency, 'currency', 3).toUpperCase();
    if (
      !CODE.test(code) ||
      !isUuid(input.partnerId) ||
      !CURRENCY.test(currency) ||
      until <= from
    )
      throw new AppError('CONTRACT_INVALID', 'Contract input is invalid', 400);
    return this.command(
      'mdm.contract.create.v1',
      input,
      context,
      metadata,
      201,
      async (tx) => {
        const partner = await tx.partner.findFirst({
          where: {
            id: input.partnerId,
            status: 'ACTIVE',
            tenantId: context.tenantId,
          },
        });
        if (!partner)
          throw new AppError(
            'CONTRACT_PARTNER_NOT_ACTIVE',
            'Active partner was not found',
            409,
          );
        const row = await tx.contract.create({
          data: {
            code,
            contractType: required(
              input.contractType,
              'contractType',
              100,
            ).toUpperCase(),
            createdBy: context.accountId,
            currency,
            effectiveFrom: from,
            effectiveUntil: until,
            id: randomUUID(),
            name: required(input.name, 'name', 300),
            partnerId: partner.id,
            partnerSnapshot: {
              code: partner.code,
              id: partner.id,
              legalName: partner.legalName,
            },
            tenantId: context.tenantId,
            terms: json(input.terms),
            updatedBy: context.accountId,
          },
        });
        await this.record(
          tx,
          'Contract',
          row.id,
          row.version,
          'mdm.contract-created.v1',
          context,
          metadata,
          { code, status: row.status },
        );
        return { contractId: row.id, status: row.status, version: row.version };
      },
    ).catch((error: unknown) => {
      throw this.unique(
        error,
        'CONTRACT_CODE_CONFLICT',
        'Contract code already exists',
      );
    });
  }
  submitContract(
    id: string,
    input: ApprovalSubmitInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.approvalInstanceId, 'APPROVAL_INSTANCE_INVALID');
    return this.contractTransition(
      id,
      'PENDING_APPROVAL',
      input,
      context,
      metadata,
      input.approvalInstanceId,
    );
  }
  decideContract(
    id: string,
    input: ApprovalDecisionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.approvalInstanceId, 'APPROVAL_INSTANCE_INVALID');
    return this.contractTransition(
      id,
      input.approved ? 'ACTIVE' : 'REJECTED',
      input,
      context,
      metadata,
      input.approvalInstanceId,
    );
  }
  changeContract(
    id: string,
    target: 'ACTIVE' | 'EXPIRED' | 'INACTIVE' | 'SUSPENDED',
    input: VersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.contractTransition(id, target, input, context, metadata);
  }
  private contractTransition(
    id: string,
    target: ContractStatus,
    input: VersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
    approvalId?: string,
  ) {
    this.uuid(id, 'CONTRACT_NOT_FOUND');
    return this.command(
      'mdm.contract.transition.v1',
      { id, target, ...input, approvalId },
      context,
      metadata,
      200,
      async (tx) => {
        const row = await tx.contract.findFirst({
          where: { id, tenantId: context.tenantId },
        });
        if (!row)
          throw new AppError(
            'CONTRACT_NOT_FOUND',
            'Contract was not found',
            404,
          );
        this.version(
          row.version,
          input.expectedVersion,
          'CONTRACT_VERSION_CONFLICT',
        );
        assertContractTransition(row.status, target);
        if (
          row.status === 'PENDING_APPROVAL' &&
          row.approvalInstanceId !== approvalId
        )
          throw new AppError(
            'CONTRACT_APPROVAL_MISMATCH',
            'Approval instance does not match',
            409,
          );
        const approved =
          target === 'ACTIVE' && row.status === 'PENDING_APPROVAL';
        const changed = await tx.contract.update({
          data: {
            approvalInstanceId:
              target === 'PENDING_APPROVAL'
                ? (approvalId ?? null)
                : row.approvalInstanceId,
            approvedAt: approved ? new Date() : row.approvedAt,
            approvedBy: approved ? context.accountId : row.approvedBy,
            status: target,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id },
        });
        await this.record(
          tx,
          'Contract',
          id,
          changed.version,
          `mdm.contract-${target.toLowerCase()}.v1`,
          context,
          metadata,
          { status: target },
          { status: row.status },
        );
        return {
          contractId: id,
          status: changed.status,
          version: changed.version,
        };
      },
    );
  }
  createRateCard(
    input: SaveRateCardInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.contractId, 'CONTRACT_NOT_FOUND');
    return this.command(
      'mdm.rate-card.create.v1',
      input,
      context,
      metadata,
      201,
      async (tx) => {
        const contract = await tx.contract.findFirst({
          where: {
            id: input.contractId,
            status: { notIn: ['INACTIVE', 'REJECTED'] },
            tenantId: context.tenantId,
          },
        });
        if (!contract)
          throw new AppError(
            'CONTRACT_NOT_FOUND',
            'Usable contract was not found',
            404,
          );
        const row = await tx.rateCard.create({
          data: {
            code: required(input.code, 'code', 100).toUpperCase(),
            contractId: input.contractId,
            createdBy: context.accountId,
            id: randomUUID(),
            name: required(input.name, 'name', 300),
            serviceType: required(
              input.serviceType,
              'serviceType',
              100,
            ).toUpperCase(),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        await this.record(
          tx,
          'RateCard',
          row.id,
          row.version,
          'mdm.rate-card-created.v1',
          context,
          metadata,
          { code: row.code },
        );
        return { rateCardId: row.id, version: row.version };
      },
    ).catch((error: unknown) => {
      throw this.unique(
        error,
        'RATE_CARD_CONFLICT',
        'Rate card already exists',
      );
    });
  }
  createRateVersion(
    input: SaveRateVersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.rateCardId, 'RATE_CARD_NOT_FOUND');
    const from = iso(input.effectiveFrom, 'effectiveFrom');
    const until = iso(input.effectiveUntil, 'effectiveUntil');
    const currency = required(input.currency, 'currency', 3).toUpperCase();
    if (
      until <= from ||
      !CURRENCY.test(currency) ||
      !Object.keys(input.dimensions).length
    )
      throw new AppError(
        'RATE_VERSION_INVALID',
        'Rate version input is invalid',
        400,
      );
    const dimensionHash = createHash('sha256')
      .update(JSON.stringify(canonical(input.dimensions)))
      .digest('hex');
    return this.command(
      'mdm.rate-version.create.v1',
      input,
      context,
      metadata,
      201,
      async (tx) => {
        if (
          !(await tx.rateCard.findFirst({
            where: {
              id: input.rateCardId,
              status: 'ACTIVE',
              tenantId: context.tenantId,
            },
          }))
        )
          throw new AppError(
            'RATE_CARD_NOT_FOUND',
            'Active rate card was not found',
            404,
          );
        const latest = await tx.rateVersion.findFirst({
          orderBy: { versionNumber: 'desc' },
          where: { rateCardId: input.rateCardId, tenantId: context.tenantId },
        });
        const row = await tx.rateVersion.create({
          data: {
            baseRate: money(input.baseRate),
            createdBy: context.accountId,
            currency,
            dimensionHash,
            dimensions: json(input.dimensions),
            effectiveFrom: from,
            effectiveUntil: until,
            id: randomUUID(),
            pricing: json(input.pricing),
            rateCardId: input.rateCardId,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            versionNumber: (latest?.versionNumber ?? 0) + 1,
          },
        });
        await this.record(
          tx,
          'RateVersion',
          row.id,
          row.version,
          'mdm.rate-version-created.v1',
          context,
          metadata,
          {
            dimensionHash,
            status: row.status,
            versionNumber: row.versionNumber,
          },
        );
        return {
          dimensionHash,
          rateVersionId: row.id,
          status: row.status,
          version: row.version,
          versionNumber: row.versionNumber,
        };
      },
    );
  }
  transitionRate(
    id: string,
    target: 'PUBLISHED' | 'RETIRED',
    input: VersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'RATE_VERSION_NOT_FOUND');
    return this.command(
      'mdm.rate-version.transition.v1',
      { id, target, ...input },
      context,
      metadata,
      200,
      async (tx) => {
        const row = await tx.rateVersion.findFirst({
          where: { id, tenantId: context.tenantId },
        });
        if (!row)
          throw new AppError(
            'RATE_VERSION_NOT_FOUND',
            'Rate version was not found',
            404,
          );
        this.version(
          row.version,
          input.expectedVersion,
          'RATE_VERSION_CONFLICT',
        );
        assertRateTransition(row.status, target);
        if (
          target === 'PUBLISHED' &&
          (await tx.rateVersion.count({
            where: {
              dimensionHash: row.dimensionHash,
              effectiveFrom: { lt: row.effectiveUntil },
              effectiveUntil: { gt: row.effectiveFrom },
              id: { not: id },
              rateCardId: row.rateCardId,
              status: 'PUBLISHED',
              tenantId: context.tenantId,
            },
          }))
        )
          throw new AppError(
            'RATE_EFFECTIVE_RANGE_OVERLAP',
            'Published rate effective range overlaps an existing version',
            409,
          );
        const changed = await tx.rateVersion.update({
          data: {
            publishedAt: target === 'PUBLISHED' ? new Date() : row.publishedAt,
            status: target,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id },
        });
        await this.record(
          tx,
          'RateVersion',
          id,
          changed.version,
          `mdm.rate-version-${target.toLowerCase()}.v1`,
          context,
          metadata,
          { status: target },
          { status: row.status },
        );
        return {
          rateVersionId: id,
          status: changed.status,
          version: changed.version,
        };
      },
    ).catch((error: unknown) => {
      if (
        isPrismaErrorCode(error, 'P2004') ||
        isPrismaErrorCode(error, '23P01')
      )
        throw new AppError(
          'RATE_EFFECTIVE_RANGE_OVERLAP',
          'Published rate effective range overlaps an existing version',
          409,
        );
      throw error;
    });
  }

  listCalendars(context: TenantContext) {
    return this.prisma.businessCalendar.findMany({
      orderBy: [{ code: 'asc' }, { versionNumber: 'desc' }],
      take: 500,
      where: { tenantId: context.tenantId },
    });
  }
  createCalendar(
    input: SaveCalendarInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const code = required(input.code, 'code', 100).toUpperCase();
    const workingDays = [...new Set(input.workingDays)].sort();
    if (
      !CODE.test(code) ||
      workingDays.some(
        (dayNumber) =>
          !Number.isInteger(dayNumber) || dayNumber < 0 || dayNumber > 6,
      ) ||
      !workingDays.length
    )
      throw new AppError('CALENDAR_INVALID', 'Calendar input is invalid', 400);
    const from = day(input.effectiveFrom, 'effectiveFrom');
    const until = input.effectiveUntil
      ? day(input.effectiveUntil, 'effectiveUntil')
      : null;
    if (until && until < from)
      throw new AppError(
        'CALENDAR_RANGE_INVALID',
        'Calendar range is invalid',
        400,
      );
    return this.command(
      'mdm.calendar.create.v1',
      input,
      context,
      metadata,
      201,
      async (tx) => {
        const latest = await tx.businessCalendar.findFirst({
          orderBy: { versionNumber: 'desc' },
          where: { code, tenantId: context.tenantId },
        });
        const row = await tx.businessCalendar.create({
          data: {
            code,
            createdBy: context.accountId,
            effectiveFrom: from,
            effectiveUntil: until,
            id: randomUUID(),
            name: required(input.name, 'name', 300),
            tenantId: context.tenantId,
            timeZone: required(input.timeZone, 'timeZone', 100),
            updatedBy: context.accountId,
            versionNumber: (latest?.versionNumber ?? 0) + 1,
            workingDays,
          },
        });
        await this.record(
          tx,
          'BusinessCalendar',
          row.id,
          row.version,
          'mdm.calendar-created.v1',
          context,
          metadata,
          { code, status: row.status, versionNumber: row.versionNumber },
        );
        return {
          calendarId: row.id,
          status: row.status,
          version: row.version,
          versionNumber: row.versionNumber,
        };
      },
    );
  }
  addCalendarDate(
    input: SaveCalendarDateInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.calendarChild(
      'CalendarDate',
      'mdm.calendar-date.create.v1',
      'mdm.calendar-date-created.v1',
      input.calendarId,
      input,
      context,
      metadata,
      (tx) =>
        tx.calendarDate.create({
          data: {
            calendarId: input.calendarId,
            createdBy: context.accountId,
            date: day(input.date, 'date'),
            id: randomUUID(),
            reason: input.reason?.trim() ?? null,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            working: input.working,
          },
        }),
    );
  }
  addShift(
    input: SaveShiftInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (
      !TIME.test(input.startTime) ||
      !TIME.test(input.endTime) ||
      input.startTime === input.endTime
    )
      throw new AppError('SHIFT_TIME_INVALID', 'Shift time is invalid', 400);
    return this.calendarChild(
      'Shift',
      'mdm.shift.create.v1',
      'mdm.shift-created.v1',
      input.calendarId,
      input,
      context,
      metadata,
      (tx) =>
        tx.shift.create({
          data: {
            calendarId: input.calendarId,
            code: required(input.code, 'code', 100).toUpperCase(),
            createdBy: context.accountId,
            crossesMidnight: input.endTime < input.startTime,
            endTime: input.endTime,
            id: randomUUID(),
            name: required(input.name, 'name', 200),
            startTime: input.startTime,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        }),
    );
  }
  addWorkingWindow(
    input: SaveWorkingWindowInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (
      !isUuid(input.resourceId) ||
      (input.shiftId && !isUuid(input.shiftId)) ||
      (input.cutoffTime && !TIME.test(input.cutoffTime)) ||
      !Number.isInteger(input.leadTimeMinutes ?? 0) ||
      (input.leadTimeMinutes ?? 0) < 0
    )
      throw new AppError(
        'WORKING_WINDOW_INVALID',
        'Working window input is invalid',
        400,
      );
    return this.calendarChild(
      'WorkingWindow',
      'mdm.working-window.create.v1',
      'mdm.working-window-created.v1',
      input.calendarId,
      input,
      context,
      metadata,
      async (tx) => {
        if (
          input.shiftId &&
          !(await tx.shift.findFirst({
            where: {
              calendarId: input.calendarId,
              id: input.shiftId,
              status: 'ACTIVE',
              tenantId: context.tenantId,
            },
          }))
        )
          throw new AppError(
            'SHIFT_NOT_FOUND',
            'Active shift was not found',
            404,
          );
        return tx.workingWindow.create({
          data: {
            calendarId: input.calendarId,
            createdBy: context.accountId,
            cutoffTime: input.cutoffTime ?? null,
            id: randomUUID(),
            leadTimeMinutes: input.leadTimeMinutes ?? 0,
            resourceId: input.resourceId,
            resourceType: required(
              input.resourceType,
              'resourceType',
              100,
            ).toUpperCase(),
            serviceType: input.serviceType?.trim().toUpperCase() ?? null,
            shiftId: input.shiftId ?? null,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      },
    );
  }
  transitionCalendar(
    id: string,
    target: 'ACTIVE' | 'INACTIVE',
    input: VersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'CALENDAR_NOT_FOUND');
    return this.command(
      'mdm.calendar.transition.v1',
      { id, target, ...input },
      context,
      metadata,
      200,
      async (tx) => {
        const row = await tx.businessCalendar.findFirst({
          where: { id, tenantId: context.tenantId },
        });
        if (!row)
          throw new AppError(
            'CALENDAR_NOT_FOUND',
            'Calendar was not found',
            404,
          );
        this.version(
          row.version,
          input.expectedVersion,
          'CALENDAR_VERSION_CONFLICT',
        );
        assertCalendarTransition(row.status, target);
        if (target === 'ACTIVE')
          await tx.businessCalendar.updateMany({
            data: {
              status: 'INACTIVE',
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: {
              code: row.code,
              id: { not: id },
              status: 'ACTIVE',
              tenantId: context.tenantId,
            },
          });
        const changed = await tx.businessCalendar.update({
          data: {
            publishedAt: target === 'ACTIVE' ? new Date() : row.publishedAt,
            status: target,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id },
        });
        await this.record(
          tx,
          'BusinessCalendar',
          id,
          changed.version,
          `mdm.calendar-${target.toLowerCase()}.v1`,
          context,
          metadata,
          { status: target },
          { status: row.status },
        );
        return {
          calendarId: id,
          status: changed.status,
          version: changed.version,
        };
      },
    );
  }
  async evaluateCalendar(input: EvaluateCalendarInput, context: TenantContext) {
    const dateValue = day(input.date, 'date');
    const calendar = await this.prisma.businessCalendar.findFirst({
      orderBy: { versionNumber: 'desc' },
      where: {
        code: input.calendarCode.trim().toUpperCase(),
        effectiveFrom: { lte: dateValue },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: dateValue } }],
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    if (!calendar)
      throw new AppError(
        'CALENDAR_NOT_ACTIVE',
        'Active calendar was not found',
        404,
      );
    const exception = await this.prisma.calendarDate.findFirst({
      where: {
        calendarId: calendar.id,
        date: dateValue,
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    const working =
      exception?.working ??
      (calendar.workingDays as number[]).includes(dateValue.getUTCDay());
    const shifts = input.localTime
      ? await this.prisma.shift.findMany({
          orderBy: { startTime: 'asc' },
          where: {
            calendarId: calendar.id,
            status: 'ACTIVE',
            tenantId: context.tenantId,
          },
        })
      : [];
    const activeShifts = input.localTime
      ? shifts.filter((shift) =>
          shift.crossesMidnight
            ? input.localTime! >= shift.startTime ||
              input.localTime! < shift.endTime
            : input.localTime! >= shift.startTime &&
              input.localTime! < shift.endTime,
        )
      : [];
    return {
      activeShiftIds: activeShifts.map(({ id }) => id),
      calendarId: calendar.id,
      calendarVersion: calendar.versionNumber,
      date: input.date,
      exceptionReason: exception?.reason ?? null,
      working,
    };
  }

  assessQuality(
    input: AssessQualityInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.objectId, 'QUALITY_OBJECT_NOT_FOUND');
    const values = Object.values(input.dimensions);
    if (
      !values.length ||
      values.some(
        (value) => !Number.isFinite(value) || value < 0 || value > 100,
      )
    )
      throw new AppError(
        'QUALITY_DIMENSIONS_INVALID',
        'Quality dimensions must be scores from 0 to 100',
        400,
      );
    const score = values.reduce((sum, value) => sum + value, 0) / values.length;
    const threshold = input.threshold ?? 80;
    if (threshold < 0 || threshold > 100)
      throw new AppError(
        'QUALITY_THRESHOLD_INVALID',
        'Quality threshold is invalid',
        400,
      );
    return this.command(
      'mdm.quality.assess.v1',
      input,
      context,
      metadata,
      201,
      async (tx) => {
        await this.assertObject(tx, input.objectType, input.objectId, context);
        const row = await tx.dataQualityAssessment.create({
          data: {
            createdBy: context.accountId,
            dimensions: json(input.dimensions),
            id: randomUUID(),
            objectId: input.objectId,
            objectType: input.objectType,
            score,
            tenantId: context.tenantId,
            threshold,
            updatedBy: context.accountId,
          },
        });
        for (const issue of input.issues ?? [])
          await tx.dataQualityIssue.create({
            data: {
              assessmentId: row.id,
              code: required(issue.code, 'issue.code', 100).toUpperCase(),
              createdBy: context.accountId,
              dimension: required(
                issue.dimension,
                'issue.dimension',
                100,
              ).toUpperCase(),
              id: randomUUID(),
              message: required(issue.message, 'issue.message', 1000),
              severity: issue.severity,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
        await this.record(
          tx,
          'DataQualityAssessment',
          row.id,
          row.version,
          'mdm.quality-assessed.v1',
          context,
          metadata,
          { score: String(score), status: row.status },
        );
        return {
          assessmentId: row.id,
          fulfillmentEligible: false,
          score: String(score),
          status: row.status,
          version: row.version,
        };
      },
    );
  }
  submitQuality(
    id: string,
    input: ApprovalSubmitInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.approvalInstanceId, 'APPROVAL_INSTANCE_INVALID');
    return this.qualityTransition(
      id,
      'PENDING_APPROVAL',
      input,
      context,
      metadata,
      input.approvalInstanceId,
    );
  }
  decideQuality(
    id: string,
    input: ApprovalDecisionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.approvalInstanceId, 'APPROVAL_INSTANCE_INVALID');
    return this.qualityTransition(
      id,
      input.approved ? 'APPROVED' : 'REJECTED',
      input,
      context,
      metadata,
      input.approvalInstanceId,
    );
  }
  private qualityTransition(
    id: string,
    target: QualityAssessmentStatus,
    input: VersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
    approvalId: string,
  ) {
    this.uuid(id, 'QUALITY_ASSESSMENT_NOT_FOUND');
    return this.command(
      'mdm.quality.transition.v1',
      { id, target, ...input, approvalId },
      context,
      metadata,
      200,
      async (tx) => {
        const row = await tx.dataQualityAssessment.findFirst({
          where: { id, tenantId: context.tenantId },
        });
        if (!row)
          throw new AppError(
            'QUALITY_ASSESSMENT_NOT_FOUND',
            'Quality assessment was not found',
            404,
          );
        this.version(
          row.version,
          input.expectedVersion,
          'QUALITY_VERSION_CONFLICT',
        );
        assertQualityTransition(row.status, target);
        if (
          row.status === 'PENDING_APPROVAL' &&
          row.approvalInstanceId !== approvalId
        )
          throw new AppError(
            'QUALITY_APPROVAL_MISMATCH',
            'Approval instance does not match',
            409,
          );
        const openErrors =
          target === 'APPROVED'
            ? await tx.dataQualityIssue.count({
                where: {
                  assessmentId: id,
                  severity: 'ERROR',
                  status: 'OPEN',
                  tenantId: context.tenantId,
                },
              })
            : 0;
        const eligible =
          target === 'APPROVED' &&
          row.score.greaterThanOrEqualTo(row.threshold) &&
          openErrors === 0;
        const changed = await tx.dataQualityAssessment.update({
          data: {
            approvalInstanceId:
              target === 'PENDING_APPROVAL'
                ? approvalId
                : row.approvalInstanceId,
            fulfillmentEligible: eligible,
            status: target,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id },
        });
        await this.record(
          tx,
          'DataQualityAssessment',
          id,
          changed.version,
          `mdm.quality-${target.toLowerCase()}.v1`,
          context,
          metadata,
          { fulfillmentEligible: eligible, status: target },
          { status: row.status },
        );
        return {
          assessmentId: id,
          fulfillmentEligible: eligible,
          status: changed.status,
          version: changed.version,
        };
      },
    );
  }
  resolveIssue(
    id: string,
    input: ResolveIssueInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'QUALITY_ISSUE_NOT_FOUND');
    return this.command(
      'mdm.quality-issue.resolve.v1',
      { id, ...input },
      context,
      metadata,
      200,
      async (tx) => {
        const row = await tx.dataQualityIssue.findFirst({
          where: { id, tenantId: context.tenantId },
        });
        if (!row)
          throw new AppError(
            'QUALITY_ISSUE_NOT_FOUND',
            'Quality issue was not found',
            404,
          );
        this.version(
          row.version,
          input.expectedVersion,
          'QUALITY_ISSUE_VERSION_CONFLICT',
        );
        if (row.status !== 'OPEN')
          throw new AppError(
            'QUALITY_ISSUE_TRANSITION_INVALID',
            'Only open issues can be resolved or waived',
            409,
          );
        const changed = await tx.dataQualityIssue.update({
          data: {
            resolution: required(input.resolution, 'resolution', 1000),
            status: input.targetStatus,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id },
        });
        await this.record(
          tx,
          'DataQualityIssue',
          id,
          changed.version,
          `mdm.quality-issue-${input.targetStatus.toLowerCase()}.v1`,
          context,
          metadata,
          { status: changed.status },
        );
        return {
          issueId: id,
          status: changed.status,
          version: changed.version,
        };
      },
    );
  }

  private calendarChild<T extends { id: string; version: number }>(
    type: string,
    scope: string,
    event: string,
    calendarId: string,
    payload: unknown,
    context: TenantContext,
    metadata: CommandMetadata,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    this.uuid(calendarId, 'CALENDAR_NOT_FOUND');
    return this.command(scope, payload, context, metadata, 201, async (tx) => {
      const calendar = await tx.businessCalendar.findFirst({
        where: { id: calendarId, status: 'DRAFT', tenantId: context.tenantId },
      });
      if (!calendar)
        throw new AppError(
          'CALENDAR_NOT_DRAFT',
          'Draft calendar was not found',
          409,
        );
      const row = await operation(tx);
      await this.record(
        tx,
        type,
        row.id,
        row.version,
        event,
        context,
        metadata,
        { calendarId },
      );
      return { id: row.id, version: row.version };
    }).catch((error: unknown) => {
      throw this.unique(
        error,
        `${type.toUpperCase()}_CONFLICT`,
        `${type} already exists`,
      );
    });
  }
  private async assertObject(
    tx: Prisma.TransactionClient,
    type: AssessQualityInput['objectType'],
    id: string,
    context: TenantContext,
  ) {
    const where = { id, tenantId: context.tenantId };
    const row =
      type === 'PARTNER'
        ? await tx.partner.findFirst({ where })
        : type === 'PRODUCT'
          ? await tx.product.findFirst({ where })
          : type === 'WAREHOUSE'
            ? await tx.warehouse.findFirst({ where })
            : type === 'VEHICLE'
              ? await tx.vehicle.findFirst({ where })
              : type === 'DRIVER'
                ? await tx.driver.findFirst({ where })
                : await tx.equipmentType.findFirst({ where });
    if (!row)
      throw new AppError(
        'QUALITY_OBJECT_NOT_FOUND',
        'MDM object was not found',
        404,
      );
  }
  private command<T extends Record<string, unknown>>(
    scope: string,
    payload: unknown,
    context: TenantContext,
    metadata: CommandMetadata,
    responseCode: number,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload,
        responseCode,
        scope,
        tenantId: context.tenantId,
      },
      operation,
    );
  }
  private async record(
    tx: Prisma.TransactionClient,
    type: string,
    id: string,
    version: number,
    event: string,
    context: TenantContext,
    metadata: CommandMetadata,
    after: Prisma.InputJsonObject,
    before?: Prisma.InputJsonObject,
  ) {
    await Promise.all([
      tx.platformAuditLog.create({
        data: {
          action: event,
          after,
          ...(before ? { before } : {}),
          category: 'BUSINESS_CHANGE',
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          deviceId: context.deviceId,
          ipAddress: metadata.ipAddress ?? null,
          resourceId: id,
          resourceType: type,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      tx.platformOutbox.create({
        data: {
          aggregateId: id,
          aggregateType: type,
          aggregateVersion: version,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          eventName: event,
          payload: { aggregateId: id, tenantId: context.tenantId, version },
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
    ]);
  }
  private uuid(id: string, code: string) {
    if (!isUuid(id)) throw new AppError(code, 'Resource was not found', 404);
  }
  private version(actual: number, expected: number, code: string) {
    if (!Number.isInteger(expected) || actual !== expected)
      throw new AppError(code, 'Resource changed; refresh and retry', 409, {
        retryable: true,
      });
  }
  private unique(error: unknown, code: string, message: string): unknown {
    return isPrismaErrorCode(error, 'P2002')
      ? new AppError(code, message, 409)
      : error;
  }
}
