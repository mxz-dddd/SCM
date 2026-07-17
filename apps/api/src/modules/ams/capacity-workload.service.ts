import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { CalendarReleaseFacade } from '../mdm/public/calendar-release.facade';
import { businessNumber } from '../platform/public/numbering.facade';
import type { CommandMetadata } from '../platform/tenant.service';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

type CapacityValues = {
  laborHours: string;
  pallets: string;
  quantity: string;
  vehicles: string;
};

@Injectable()
export class CapacityWorkloadService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CalendarReleaseFacade)
    private readonly calendars: CalendarReleaseFacade,
  ) {}

  async workbench(context: TenantContext) {
    const where = { tenantId: context.tenantId };
    const [profiles, calendars, slots, changes, rules, estimates] =
      await Promise.all([
        this.prisma.capacityProfile.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 100,
          where,
        }),
        this.prisma.capacityCalendar.findMany({
          orderBy: [{ calendarDate: 'desc' }, { id: 'desc' }],
          take: 100,
          where,
        }),
        this.prisma.timeSlot.findMany({
          orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
          take: 300,
          where,
        }),
        this.prisma.capacityChange.findMany({
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: 300,
          where,
        }),
        this.prisma.workloadRule.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 100,
          where,
        }),
        this.prisma.workloadEstimate.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 100,
          where,
        }),
      ]);
    return toHttpJson({
      calendars,
      changes,
      estimates,
      profiles,
      rules,
      slots,
    });
  }

  async slots(
    query: {
      from?: string;
      serviceType?: string;
      status?: 'OPEN' | 'CLOSED';
      to?: string;
      warehouseRef?: string;
    },
    context: TenantContext,
  ) {
    const from = query.from ? this.date(query.from) : new Date();
    const to = query.to
      ? this.date(query.to)
      : new Date(from.getTime() + 14 * 86_400_000);
    if (to <= from) this.invalid('Slot query range is invalid');
    const items = await this.prisma.timeSlot.findMany({
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: 500,
      where: {
        startsAt: { gte: from, lt: to },
        ...(query.serviceType
          ? { serviceType: query.serviceType.trim().toUpperCase() }
          : {}),
        ...(query.status ? { status: query.status } : {}),
        tenantId: context.tenantId,
        ...(query.warehouseRef ? { warehouseRef: query.warehouseRef } : {}),
      },
    });
    return toHttpJson({
      items,
      snapshotAt: new Date().toISOString(),
      version: items.reduce(
        (maximum, item) => Math.max(maximum, item.version),
        0,
      ),
    });
  }

  createProfile(
    input: {
      blacklistDates: readonly string[];
      calendarCode: string;
      capacity: CapacityValues & { quantityUom: string };
      effectiveFrom: string;
      effectiveUntil?: string;
      internalReserve: CapacityValues;
      leadTimeMinutes: number;
      profileCode: string;
      resourceRef: string;
      resourceSnapshot: Readonly<Record<string, unknown>>;
      resourceType: 'WAREHOUSE' | 'DOCK' | 'ZONE' | 'TEAM' | 'SERVICE';
      revision: number;
      serviceType: string;
      shiftCode: string;
      shiftEndTime: string;
      shiftStartTime: string;
      slotMinutes: number;
      warehouseRef: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.warehouseRef, 'warehouseRef');
    this.uuid(input.resourceRef, 'resourceRef');
    if (
      !input.profileCode?.trim() ||
      !input.calendarCode?.trim() ||
      !input.serviceType?.trim() ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.shiftStartTime) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.shiftEndTime) ||
      input.shiftStartTime === input.shiftEndTime ||
      !Number.isInteger(input.revision) ||
      input.revision < 1 ||
      !Number.isInteger(input.slotMinutes) ||
      input.slotMinutes < 1 ||
      input.slotMinutes > 1_440 ||
      !Number.isInteger(input.leadTimeMinutes) ||
      input.leadTimeMinutes < 0
    )
      this.invalid('Capacity profile identity, shift or interval is invalid');
    const effectiveFrom = this.day(input.effectiveFrom);
    const effectiveUntil = input.effectiveUntil
      ? this.day(input.effectiveUntil)
      : undefined;
    if (effectiveUntil && effectiveUntil < effectiveFrom)
      this.invalid('Capacity profile effective range is invalid');
    const capacity = this.capacity(input.capacity);
    const internal = this.capacity(input.internalReserve);
    this.assertWithin(internal, capacity, 'Internal reserve exceeds capacity');
    const blacklistDates = [
      ...new Set(input.blacklistDates.map((item) => this.isoDay(item))),
    ].sort();
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.capacityProfile.create({
        data: {
          blacklistDates,
          calendarCode: input.calendarCode.trim().toUpperCase(),
          capacityLaborHours: capacity.laborHours,
          capacityPallets: capacity.pallets,
          capacityQuantity: capacity.quantity,
          capacityQuantityUom: input.capacity.quantityUom.trim().toUpperCase(),
          capacityVehicles: capacity.vehicles,
          createdBy: context.accountId,
          effectiveFrom,
          ...(effectiveUntil ? { effectiveUntil } : {}),
          internalLaborHours: internal.laborHours,
          internalPallets: internal.pallets,
          internalQuantity: internal.quantity,
          internalVehicles: internal.vehicles,
          leadTimeMinutes: input.leadTimeMinutes,
          profileCode: input.profileCode.trim().toUpperCase(),
          resourceRef: input.resourceRef,
          resourceSnapshot: json(input.resourceSnapshot),
          resourceType: input.resourceType,
          revision: input.revision,
          serviceType: input.serviceType.trim().toUpperCase(),
          shiftCode: input.shiftCode.trim().toUpperCase(),
          shiftEndTime: input.shiftEndTime,
          shiftStartTime: input.shiftStartTime,
          slotMinutes: input.slotMinutes,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          warehouseRef: input.warehouseRef,
        },
      });
      await this.emit(
        tx,
        profile.id,
        profile.version,
        'ams.capacity-profile-created.v1',
        context,
        metadata,
        {
          capacityProfileId: profile.id,
          profileCode: profile.profileCode,
          revision: profile.revision,
        },
        'CapacityProfile',
      );
      return {
        capacityProfileId: profile.id,
        status: profile.status,
        version: profile.version,
      };
    });
  }

  publishProfile(
    id: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'capacityProfileId');
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.capacityProfile.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (
        !current ||
        current.status !== 'DRAFT' ||
        current.version !== input.expectedVersion
      )
        throw this.conflict('AMS_CAPACITY_PROFILE_VERSION_CONFLICT');
      const duplicate = await tx.capacityProfile.count({
        where: {
          profileCode: current.profileCode,
          status: 'PUBLISHED',
          tenantId: context.tenantId,
        },
      });
      if (duplicate)
        throw new AppError(
          'AMS_CAPACITY_PROFILE_PUBLISHED_EXISTS',
          'A published profile already exists for this code',
          409,
        );
      const changed = await tx.capacityProfile.update({
        data: {
          publishedAt: new Date(),
          status: 'PUBLISHED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.emit(
        tx,
        id,
        changed.version,
        'ams.capacity-profile-published.v1',
        context,
        metadata,
        {
          capacityProfileId: id,
          profileCode: changed.profileCode,
          revision: changed.revision,
        },
        'CapacityProfile',
      );
      return {
        capacityProfileId: id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  async generateSlots(
    input: { dateFrom: string; dateTo: string; profileId: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.profileId, 'profileId');
    const dateFrom = this.day(input.dateFrom);
    const dateTo = this.day(input.dateTo);
    if (
      dateTo < dateFrom ||
      dateTo.getTime() - dateFrom.getTime() > 93 * 86_400_000
    )
      this.invalid('Slot generation range must be between 1 and 94 days');
    const profile = await this.prisma.capacityProfile.findFirst({
      where: {
        id: input.profileId,
        status: 'PUBLISHED',
        tenantId: context.tenantId,
      },
    });
    if (!profile)
      throw new AppError(
        'AMS_CAPACITY_PROFILE_NOT_PUBLISHED',
        'Published capacity profile was not found',
        404,
      );
    const blacklisted = new Set(
      Array.isArray(profile.blacklistDates)
        ? profile.blacklistDates.map(String)
        : [],
    );
    const generatedIds: string[] = [];
    const skipped: { date: string; reason: string }[] = [];
    for (
      let cursor = dateFrom;
      cursor <= dateTo;
      cursor = new Date(cursor.getTime() + 86_400_000)
    ) {
      const date = cursor.toISOString().slice(0, 10);
      if (
        cursor < profile.effectiveFrom ||
        (profile.effectiveUntil && cursor > profile.effectiveUntil)
      ) {
        skipped.push({ date, reason: 'OUTSIDE_EFFECTIVE_RANGE' });
        continue;
      }
      if (blacklisted.has(date)) {
        skipped.push({ date, reason: 'BLACKLISTED' });
        continue;
      }
      const shiftStart = new Date(`${date}T${profile.shiftStartTime}:00.000Z`);
      let shiftEnd = new Date(`${date}T${profile.shiftEndTime}:00.000Z`);
      if (shiftEnd <= shiftStart)
        shiftEnd = new Date(shiftEnd.getTime() + 86_400_000);
      const release = await this.calendars.evaluate(
        profile.calendarCode,
        profile.resourceRef,
        profile.serviceType,
        shiftStart,
        context,
      );
      if (!release.working) {
        skipped.push({ date, reason: 'NON_WORKING_DAY' });
        continue;
      }
      const result = await this.prisma.$transaction(async (tx) => {
        await this.lock(
          tx,
          `${context.tenantId}:${profile.id}:${date}:${profile.shiftCode}`,
        );
        const calendar = await tx.capacityCalendar.upsert({
          create: {
            calendarDate: cursor,
            calendarSnapshot: json(release),
            capacityProfileId: profile.id,
            createdBy: context.accountId,
            shiftCode: profile.shiftCode,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
          update: {},
          where: {
            tenantId_capacityProfileId_calendarDate_shiftCode: {
              calendarDate: cursor,
              capacityProfileId: profile.id,
              shiftCode: profile.shiftCode,
              tenantId: context.tenantId,
            },
          },
        });
        const ids: string[] = [];
        for (
          let startsAt = shiftStart;
          startsAt < shiftEnd;
          startsAt = new Date(startsAt.getTime() + profile.slotMinutes * 60_000)
        ) {
          const endsAt = new Date(
            Math.min(
              shiftEnd.getTime(),
              startsAt.getTime() + profile.slotMinutes * 60_000,
            ),
          );
          if (
            startsAt.getTime() <
            Date.now() + profile.leadTimeMinutes * 60_000
          )
            continue;
          const existing = await tx.timeSlot.findUnique({
            where: {
              tenantId_capacityProfileId_startsAt: {
                capacityProfileId: profile.id,
                startsAt,
                tenantId: context.tenantId,
              },
            },
          });
          if (existing) {
            ids.push(existing.id);
            continue;
          }
          const slot = await tx.timeSlot.create({
            data: {
              calendarSnapshot: json(release),
              capacityCalendarId: calendar.id,
              capacityLaborHours: profile.capacityLaborHours,
              capacityPallets: profile.capacityPallets,
              capacityProfileId: profile.id,
              capacityQuantity: profile.capacityQuantity,
              capacityQuantityUom: profile.capacityQuantityUom,
              capacityVehicles: profile.capacityVehicles,
              createdBy: context.accountId,
              endsAt,
              internalLaborHours: profile.internalLaborHours,
              internalPallets: profile.internalPallets,
              internalQuantity: profile.internalQuantity,
              internalVehicles: profile.internalVehicles,
              resourceRef: profile.resourceRef,
              resourceType: profile.resourceType,
              serviceType: profile.serviceType,
              startsAt,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
              warehouseRef: profile.warehouseRef,
            },
          });
          await tx.capacityChange.create({
            data: {
              afterSnapshot: this.slotSnapshot(slot),
              beforeSnapshot: {},
              changeType: 'GENERATED',
              createdBy: context.accountId,
              reason: `Generated from ${profile.profileCode}#${profile.revision}`,
              sequence: 1,
              tenantId: context.tenantId,
              timeSlotId: slot.id,
              updatedBy: context.accountId,
            },
          });
          ids.push(slot.id);
        }
        return ids;
      });
      generatedIds.push(...result);
    }
    await this.prisma.$transaction((tx) =>
      this.emit(
        tx,
        profile.id,
        profile.version,
        'ams.time-slots-generated.v1',
        context,
        metadata,
        { capacityProfileId: profile.id, slotIds: generatedIds },
        'CapacityProfile',
      ),
    );
    return {
      capacityProfileId: profile.id,
      generatedCount: generatedIds.length,
      skipped,
      slotIds: generatedIds,
      status: 'COMPLETED' as const,
      version: profile.version,
    };
  }

  changeSlot(
    id: string,
    input: {
      action: 'CLOSE' | 'REOPEN' | 'EXPAND' | 'RESERVE_INTERNAL';
      delta?: CapacityValues;
      expectedVersion: number;
      reason: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'timeSlotId');
    if (!input.reason?.trim()) this.invalid('Slot change reason is required');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:${id}:slot-change`);
      const current = await tx.timeSlot.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!current || current.version !== input.expectedVersion)
        throw this.conflict('AMS_TIME_SLOT_VERSION_CONFLICT');
      if (
        (input.action === 'CLOSE' && current.status !== 'OPEN') ||
        (input.action === 'REOPEN' && current.status !== 'CLOSED') ||
        (['EXPAND', 'RESERVE_INTERNAL'].includes(input.action) &&
          current.status !== 'OPEN')
      )
        throw new AppError(
          'AMS_TIME_SLOT_STATE_INVALID',
          'Time slot action is not allowed in its current state',
          409,
        );
      const delta = input.delta ? this.capacity(input.delta) : undefined;
      if (
        ['EXPAND', 'RESERVE_INTERNAL'].includes(input.action) &&
        (!delta || !this.anyPositive(delta))
      )
        this.invalid('Positive capacity delta is required');
      const data: Prisma.TimeSlotUpdateInput = {
        updatedBy: context.accountId,
        version: { increment: 1 },
      };
      if (input.action === 'CLOSE')
        Object.assign(data, {
          closeReason: input.reason.trim(),
          closedAt: new Date(),
          status: 'CLOSED',
        });
      if (input.action === 'REOPEN')
        Object.assign(data, {
          closeReason: null,
          closedAt: null,
          status: 'OPEN',
        });
      if (input.action === 'EXPAND' && delta)
        Object.assign(data, {
          capacityLaborHours: { increment: delta.laborHours },
          capacityPallets: { increment: delta.pallets },
          capacityQuantity: { increment: delta.quantity },
          capacityVehicles: { increment: delta.vehicles },
        });
      if (input.action === 'RESERVE_INTERNAL' && delta) {
        const after = {
          laborHours: current.internalLaborHours.add(delta.laborHours),
          pallets: current.internalPallets.add(delta.pallets),
          quantity: current.internalQuantity.add(delta.quantity),
          vehicles: current.internalVehicles.add(delta.vehicles),
        };
        this.assertWithin(
          after,
          {
            laborHours: current.capacityLaborHours,
            pallets: current.capacityPallets,
            quantity: current.capacityQuantity,
            vehicles: current.capacityVehicles,
          },
          'Internal reserve exceeds capacity',
        );
        Object.assign(data, {
          internalLaborHours: after.laborHours,
          internalPallets: after.pallets,
          internalQuantity: after.quantity,
          internalVehicles: after.vehicles,
        });
      }
      const changed = await tx.timeSlot.update({ data, where: { id } });
      const sequence =
        (await tx.capacityChange.count({
          where: { tenantId: context.tenantId, timeSlotId: id },
        })) + 1;
      const type = (
        {
          CLOSE: 'CLOSED',
          EXPAND: 'EXPANDED',
          REOPEN: 'REOPENED',
          RESERVE_INTERNAL: 'RESERVED_INTERNAL',
        } as const
      )[input.action];
      await tx.capacityChange.create({
        data: {
          afterSnapshot: this.slotSnapshot(changed),
          beforeSnapshot: this.slotSnapshot(current),
          changeType: type,
          createdBy: context.accountId,
          reason: input.reason.trim(),
          sequence,
          tenantId: context.tenantId,
          timeSlotId: id,
          updatedBy: context.accountId,
        },
      });
      await this.emit(
        tx,
        id,
        changed.version,
        'ams.time-slot-changed.v1',
        context,
        metadata,
        { action: input.action, status: changed.status, timeSlotId: id },
        'TimeSlot',
      );
      return {
        status: changed.status,
        timeSlotId: id,
        version: changed.version,
      };
    });
  }

  createWorkloadRule(
    input: {
      baseMinutes: string;
      effectiveFrom: string;
      effectiveUntil?: string;
      historicalEfficiency: string;
      loadingMethodFactors: Readonly<Record<string, string>>;
      packagingFactors: Readonly<Record<string, string>>;
      perOrderLineMinutes: string;
      perPalletMinutes: string;
      perQuantityMinutes: string;
      perVehicleMinutes: string;
      revision: number;
      ruleCode: string;
      serviceType: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (
      !input.ruleCode?.trim() ||
      !input.serviceType?.trim() ||
      !Number.isInteger(input.revision) ||
      input.revision < 1
    )
      this.invalid('Workload rule identity is invalid');
    const effectiveFrom = this.date(input.effectiveFrom);
    const effectiveUntil = input.effectiveUntil
      ? this.date(input.effectiveUntil)
      : undefined;
    if (effectiveUntil && effectiveUntil < effectiveFrom)
      this.invalid('Workload rule effective range is invalid');
    for (const factors of [input.packagingFactors, input.loadingMethodFactors])
      for (const value of Object.values(factors)) this.positive(value, true);
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.workloadRule.create({
        data: {
          baseMinutes: this.positive(input.baseMinutes),
          createdBy: context.accountId,
          effectiveFrom,
          ...(effectiveUntil ? { effectiveUntil } : {}),
          historicalEfficiency: this.positive(input.historicalEfficiency, true),
          loadingMethodFactors: json(input.loadingMethodFactors),
          packagingFactors: json(input.packagingFactors),
          perOrderLineMinutes: this.positive(input.perOrderLineMinutes),
          perPalletMinutes: this.positive(input.perPalletMinutes),
          perQuantityMinutes: this.positive(input.perQuantityMinutes),
          perVehicleMinutes: this.positive(input.perVehicleMinutes),
          revision: input.revision,
          ruleCode: input.ruleCode.trim().toUpperCase(),
          serviceType: input.serviceType.trim().toUpperCase(),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.emit(
        tx,
        rule.id,
        rule.version,
        'ams.workload-rule-created.v1',
        context,
        metadata,
        {
          revision: rule.revision,
          ruleCode: rule.ruleCode,
          workloadRuleId: rule.id,
        },
        'WorkloadRule',
      );
      return {
        status: rule.status,
        version: rule.version,
        workloadRuleId: rule.id,
      };
    });
  }

  publishWorkloadRule(
    id: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'workloadRuleId');
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.workloadRule.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (
        !current ||
        current.status !== 'DRAFT' ||
        current.version !== input.expectedVersion
      )
        throw this.conflict('AMS_WORKLOAD_RULE_VERSION_CONFLICT');
      const duplicate = await tx.workloadRule.count({
        where: {
          ruleCode: current.ruleCode,
          status: 'PUBLISHED',
          tenantId: context.tenantId,
        },
      });
      if (duplicate)
        throw new AppError(
          'AMS_WORKLOAD_RULE_PUBLISHED_EXISTS',
          'A published workload rule already exists for this code',
          409,
        );
      const changed = await tx.workloadRule.update({
        data: {
          publishedAt: new Date(),
          status: 'PUBLISHED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.emit(
        tx,
        id,
        changed.version,
        'ams.workload-rule-published.v1',
        context,
        metadata,
        {
          revision: changed.revision,
          ruleCode: changed.ruleCode,
          workloadRuleId: id,
        },
        'WorkloadRule',
      );
      return {
        status: changed.status,
        version: changed.version,
        workloadRuleId: id,
      };
    });
  }

  estimate(
    input: {
      asOf: string;
      loadingMethod: string;
      orderLineCount: number;
      packagingType: string;
      pallets: string;
      quantity: string;
      quantityUom: string;
      ruleCode: string;
      sourceRef: string;
      vehicles: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const asOf = this.date(input.asOf);
    if (
      !input.sourceRef?.trim() ||
      !Number.isInteger(input.orderLineCount) ||
      input.orderLineCount < 0
    )
      this.invalid('Workload input is invalid');
    return this.prisma.$transaction(async (tx) => {
      const matches = await tx.workloadRule.findMany({
        where: {
          effectiveFrom: { lte: asOf },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: asOf } }],
          ruleCode: input.ruleCode.trim().toUpperCase(),
          status: 'PUBLISHED',
          tenantId: context.tenantId,
        },
      });
      if (matches.length !== 1)
        throw new AppError(
          'AMS_WORKLOAD_RULE_MATCH_INVALID',
          'Exactly one published workload rule must match',
          409,
        );
      const rule = matches[0]!;
      const quantity = this.positive(input.quantity);
      const pallets = this.positive(input.pallets);
      const vehicles = this.positive(input.vehicles);
      const packagingFactor = this.factor(
        rule.packagingFactors,
        input.packagingType,
      );
      const loadingFactor = this.factor(
        rule.loadingMethodFactors,
        input.loadingMethod,
      );
      const rawMinutes = rule.baseMinutes
        .add(rule.perOrderLineMinutes.mul(input.orderLineCount))
        .add(rule.perQuantityMinutes.mul(quantity))
        .add(rule.perPalletMinutes.mul(pallets))
        .add(rule.perVehicleMinutes.mul(vehicles));
      const laborHours = rawMinutes
        .mul(packagingFactor)
        .mul(loadingFactor)
        .div(rule.historicalEfficiency)
        .div(60)
        .toDecimalPlaces(6);
      const id = randomUUID();
      const estimate = await tx.workloadEstimate.create({
        data: {
          calculationTrace: json({
            formula:
              '((base + lines*line + quantity*qty + pallets*pallet + vehicles*vehicle) * packagingFactor * loadingFactor) / historicalEfficiency / 60',
            loadingFactor: loadingFactor.toString(),
            packagingFactor: packagingFactor.toString(),
            rawMinutes: rawMinutes.toString(),
            ruleRevision: rule.revision,
          }),
          createdBy: context.accountId,
          estimateNo: await businessNumber(
            this.prisma,
            'AMS_WORKLOAD_ESTIMATE',
            context,
            metadata,
            `workload-estimate:${input.sourceRef}`,
          ),
          id,
          inputSnapshot: json(input),
          laborHours,
          pallets,
          quantity,
          quantityUom: input.quantityUom.trim().toUpperCase(),
          ruleCode: rule.ruleCode,
          ruleRevision: rule.revision,
          sourceRef: input.sourceRef.trim(),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          vehicles,
          workloadRuleId: rule.id,
        },
      });
      await this.emit(
        tx,
        estimate.id,
        estimate.version,
        'ams.workload-estimated.v1',
        context,
        metadata,
        {
          laborHours: laborHours.toString(),
          sourceRef: estimate.sourceRef,
          workloadEstimateId: estimate.id,
          workloadRuleId: rule.id,
        },
        'WorkloadEstimate',
      );
      return toHttpJson({
        laborHours,
        status: estimate.status,
        version: estimate.version,
        workloadEstimateId: estimate.id,
      });
    });
  }

  adjustEstimate(
    id: string,
    input: {
      laborHours: string;
      pallets: string;
      quantity: string;
      quantityUom: string;
      reason: string;
      vehicles: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'workloadEstimateId');
    if (!input.reason?.trim())
      this.invalid('Manual adjustment reason is required');
    return this.prisma.$transaction(async (tx) => {
      const original = await tx.workloadEstimate.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!original)
        throw new AppError(
          'AMS_WORKLOAD_ESTIMATE_NOT_FOUND',
          'Workload estimate was not found',
          404,
        );
      const adjustedId = randomUUID();
      const adjusted = await tx.workloadEstimate.create({
        data: {
          adjustmentReason: input.reason.trim(),
          calculationTrace: json({
            adjustmentReason: input.reason.trim(),
            originalEstimateId: id,
            originalOutput: {
              laborHours: original.laborHours.toString(),
              pallets: original.pallets.toString(),
              quantity: original.quantity.toString(),
              vehicles: original.vehicles.toString(),
            },
          }),
          createdBy: context.accountId,
          estimateNo: await businessNumber(
            this.prisma,
            'AMS_WORKLOAD_ADJUSTMENT',
            context,
            metadata,
            `workload-adjustment:${id}:${original.version}`,
          ),
          id: adjustedId,
          inputSnapshot: json(original.inputSnapshot),
          laborHours: this.positive(input.laborHours),
          originalEstimateId: id,
          pallets: this.positive(input.pallets),
          quantity: this.positive(input.quantity),
          quantityUom: input.quantityUom.trim().toUpperCase(),
          ruleCode: original.ruleCode,
          ruleRevision: original.ruleRevision,
          sourceRef: original.sourceRef,
          status: 'ADJUSTED',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          vehicles: this.positive(input.vehicles),
          workloadRuleId: original.workloadRuleId,
        },
      });
      await this.emit(
        tx,
        adjusted.id,
        adjusted.version,
        'ams.workload-adjusted.v1',
        context,
        metadata,
        { originalEstimateId: id, workloadEstimateId: adjusted.id },
        'WorkloadEstimate',
      );
      return toHttpJson({
        originalEstimateId: id,
        status: adjusted.status,
        version: adjusted.version,
        workloadEstimateId: adjusted.id,
      });
    });
  }

  private capacity(value: CapacityValues) {
    return {
      laborHours: this.positive(value.laborHours),
      pallets: this.positive(value.pallets),
      quantity: this.positive(value.quantity),
      vehicles: this.positive(value.vehicles),
    };
  }
  private assertWithin(
    left: {
      laborHours: Prisma.Decimal;
      pallets: Prisma.Decimal;
      quantity: Prisma.Decimal;
      vehicles: Prisma.Decimal;
    },
    right: {
      laborHours: Prisma.Decimal;
      pallets: Prisma.Decimal;
      quantity: Prisma.Decimal;
      vehicles: Prisma.Decimal;
    },
    message: string,
  ) {
    if (
      left.laborHours.gt(right.laborHours) ||
      left.pallets.gt(right.pallets) ||
      left.quantity.gt(right.quantity) ||
      left.vehicles.gt(right.vehicles)
    )
      this.invalid(message);
  }
  private anyPositive(value: {
    laborHours: Prisma.Decimal;
    pallets: Prisma.Decimal;
    quantity: Prisma.Decimal;
    vehicles: Prisma.Decimal;
  }) {
    return (
      value.laborHours.gt(0) ||
      value.pallets.gt(0) ||
      value.quantity.gt(0) ||
      value.vehicles.gt(0)
    );
  }
  private factor(value: unknown, key: string) {
    const selected =
      object(value)[key.trim().toUpperCase()] ?? object(value).DEFAULT ?? '1';
    return this.positive(String(selected), true);
  }
  private slotSnapshot(slot: {
    capacityLaborHours: Prisma.Decimal;
    capacityPallets: Prisma.Decimal;
    capacityQuantity: Prisma.Decimal;
    capacityVehicles: Prisma.Decimal;
    internalLaborHours: Prisma.Decimal;
    internalPallets: Prisma.Decimal;
    internalQuantity: Prisma.Decimal;
    internalVehicles: Prisma.Decimal;
    status: string;
    version: number;
  }) {
    return json({
      capacity: {
        laborHours: slot.capacityLaborHours.toString(),
        pallets: slot.capacityPallets.toString(),
        quantity: slot.capacityQuantity.toString(),
        vehicles: slot.capacityVehicles.toString(),
      },
      internalReserve: {
        laborHours: slot.internalLaborHours.toString(),
        pallets: slot.internalPallets.toString(),
        quantity: slot.internalQuantity.toString(),
        vehicles: slot.internalVehicles.toString(),
      },
      status: slot.status,
      version: slot.version,
    });
  }
  private positive(value: string, excludeZero = false) {
    try {
      const result = new Prisma.Decimal(value);
      if (
        !result.isFinite() ||
        result.isNegative() ||
        (excludeZero && result.isZero())
      )
        throw new Error();
      return result;
    } catch {
      this.invalid('Decimal value is invalid');
    }
  }
  private date(value: string) {
    const result = new Date(value);
    if (!value || Number.isNaN(result.getTime()))
      this.invalid('Date is invalid');
    return result;
  }
  private day(value: string) {
    return new Date(`${this.isoDay(value)}T00:00:00.000Z`);
  }
  private isoDay(value: string) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime())
    )
      this.invalid('Date must use YYYY-MM-DD');
    return value;
  }
  private uuid(value: string, field: string) {
    if (!isUuid(value)) this.invalid(`${field} is invalid`);
  }
  private invalid(message: string): never {
    throw new AppError('AMS_CAPACITY_INPUT_INVALID', message, 400);
  }
  private conflict(code: string) {
    return new AppError(code, 'Resource version or state changed', 409, {
      retryable: true,
    });
  }
  private async lock(tx: Prisma.TransactionClient, key: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
  }
  private async emit(
    tx: Prisma.TransactionClient,
    id: string,
    version: number,
    eventName: string,
    context: TenantContext,
    metadata: CommandMetadata,
    payload: Prisma.InputJsonObject,
    aggregateType: string,
  ) {
    await Promise.all([
      tx.platformAuditLog.create({
        data: {
          action: eventName,
          after: payload,
          category: 'BUSINESS_CHANGE',
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          deviceId: context.deviceId,
          ipAddress: metadata.ipAddress ?? null,
          resourceId: id,
          resourceType: aggregateType,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      tx.platformOutbox.create({
        data: {
          aggregateId: id,
          aggregateType,
          aggregateVersion: version,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          eventName,
          partitionKey: id,
          payload: { ...payload, tenantId: context.tenantId },
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
    ]);
  }
}
