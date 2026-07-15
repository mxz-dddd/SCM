import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import type { BusinessEventInput } from '../platform/event.service';
import { EventConsumptionFacade } from '../platform/public/event-consumption.facade';
import type { CommandMetadata } from '../platform/tenant.service';
import {
  assertProcessStepTransition,
  assertProcessTransition,
} from './fulfillment-process.state';

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

@Injectable()
export class FulfillmentProcessService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventConsumptionFacade)
    private readonly events: EventConsumptionFacade,
  ) {}

  async list(context: TenantContext, status?: string) {
    const statuses = [
      'STARTED',
      'WAITING_DOWNSTREAM',
      'EXECUTING',
      'COMPLETED',
      'FAILED',
      'COMPENSATING',
      'MANUAL_INTERVENTION',
    ] as const;
    if (status && !statuses.includes(status as (typeof statuses)[number]))
      throw new AppError(
        'FULFILLMENT_PROCESS_STATUS_INVALID',
        'Process status is invalid',
        400,
      );
    const processes = await this.prisma.orderFulfillmentProcess.findMany({
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 200,
      where: {
        tenantId: context.tenantId,
        ...(status ? { status: status as never } : {}),
      },
    });
    return toHttpJson({ items: processes });
  }

  async get(processId: string, context: TenantContext) {
    this.uuid(processId, 'FULFILLMENT_PROCESS_NOT_FOUND');
    const process = await this.prisma.orderFulfillmentProcess.findFirst({
      where: { id: processId, tenantId: context.tenantId },
    });
    if (!process)
      throw new AppError(
        'FULFILLMENT_PROCESS_NOT_FOUND',
        'Fulfillment process was not found',
        404,
      );
    const [steps, links] = await Promise.all([
      this.prisma.orderFulfillmentStep.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        where: { processId, tenantId: context.tenantId },
      }),
      this.prisma.crossDomainObjectLink.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        where: { processId, tenantId: context.tenantId },
      }),
    ]);
    return toHttpJson({ links, process, steps });
  }

  consume(
    event: BusinessEventInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.events.consumeOmsFulfillmentProcess(
      event,
      context,
      metadata,
      async (message, transaction) => {
        if (message.eventType === 'control.event-delivery-dead-lettered.v1')
          return this.failFromDeadLetter(
            message,
            transaction,
            context,
            metadata,
          );
        const matches = this.downstreamMatches(message);
        if (!matches.length)
          return { eventId: message.eventId, status: 'IGNORED' };
        const results = [];
        for (const match of matches) {
          const result = await this.succeedStep(
            transaction,
            message,
            match,
            context,
            metadata,
          );
          if (result) results.push(result);
        }
        return results.length
          ? { results, status: 'PROCESSED' }
          : { eventId: message.eventId, status: 'IGNORED' };
      },
    );
  }

  async retryStep(
    processId: string,
    stepId: string,
    input: { expectedProcessVersion: number; expectedStepVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(processId, 'FULFILLMENT_PROCESS_NOT_FOUND');
    this.uuid(stepId, 'FULFILLMENT_STEP_NOT_FOUND');
    if (
      !Number.isInteger(input.expectedProcessVersion) ||
      input.expectedProcessVersion < 1 ||
      !Number.isInteger(input.expectedStepVersion) ||
      input.expectedStepVersion < 1
    )
      throw new AppError(
        'FULFILLMENT_RETRY_VERSION_INVALID',
        'Expected versions must be positive integers',
        400,
      );
    return this.prisma.$transaction(async (transaction) => {
      const [process, step] = await Promise.all([
        transaction.orderFulfillmentProcess.findFirst({
          where: { id: processId, tenantId: context.tenantId },
        }),
        transaction.orderFulfillmentStep.findFirst({
          where: { id: stepId, processId, tenantId: context.tenantId },
        }),
      ]);
      if (!process || process.version !== input.expectedProcessVersion)
        throw new AppError(
          'FULFILLMENT_PROCESS_CONFLICT',
          'Process changed; refresh and retry',
          409,
          { retryable: true },
        );
      if (!step || step.version !== input.expectedStepVersion)
        throw new AppError(
          'FULFILLMENT_STEP_CONFLICT',
          'Step changed; refresh and retry',
          409,
          { retryable: true },
        );
      assertProcessStepTransition(step.status, 'PENDING');
      assertProcessTransition(process.status, 'WAITING_DOWNSTREAM');
      const snapshot = object(step.inputSnapshot);
      const payload = object(snapshot.payload);
      const eventType = text(snapshot.eventType);
      const aggregateId = text(payload.sourceRef);
      const aggregateVersion = Number(payload.sourceVersion);
      if (
        !eventType ||
        !aggregateId ||
        !isUuid(aggregateId) ||
        !Number.isInteger(aggregateVersion)
      )
        throw new AppError(
          'FULFILLMENT_RETRY_SNAPSHOT_INVALID',
          'Step retry snapshot is invalid',
          409,
        );
      const sourceEventId = randomUUID();
      await transaction.platformOutbox.create({
        data: {
          aggregateId,
          aggregateType:
            step.stepType === 'CREATE_WMS_OUTBOUND'
              ? 'FulfillmentOrder'
              : 'ShipmentRequest',
          aggregateVersion,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          eventName: eventType,
          id: sourceEventId,
          partitionKey: aggregateId,
          payload: json({ ...payload, tenantId: context.tenantId }),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const changedStep = await transaction.orderFulfillmentStep.update({
        data: {
          idempotencyKey: `${aggregateId}:${aggregateVersion}:${step.stepType}:retry-${step.attemptCount + 1}`,
          lastError: null,
          sourceEventId,
          status: 'PENDING',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: step.id },
      });
      const changedProcess = await transaction.orderFulfillmentProcess.update({
        data: {
          failureCode: null,
          failureMessage: null,
          manualInterventionRequired: false,
          status: 'WAITING_DOWNSTREAM',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: process.id },
      });
      await this.record(
        transaction,
        process.id,
        changedProcess.version,
        'oms.fulfillment-step-retried.v1',
        context,
        metadata,
        { processId, sourceEventId, stepId },
      );
      return {
        processVersion: changedProcess.version,
        sourceEventId,
        status: changedStep.status,
        stepVersion: changedStep.version,
      };
    });
  }

  async compensateStep(
    processId: string,
    stepId: string,
    input: {
      expectedProcessVersion: number;
      expectedStepVersion: number;
      reason: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(processId, 'FULFILLMENT_PROCESS_NOT_FOUND');
    this.uuid(stepId, 'FULFILLMENT_STEP_NOT_FOUND');
    if (!input.reason?.trim())
      throw new AppError(
        'FULFILLMENT_COMPENSATION_REASON_REQUIRED',
        'Compensation reason is required',
        400,
      );
    return this.prisma.$transaction(async (transaction) => {
      const [process, step] = await Promise.all([
        transaction.orderFulfillmentProcess.findFirst({
          where: { id: processId, tenantId: context.tenantId },
        }),
        transaction.orderFulfillmentStep.findFirst({
          where: { id: stepId, processId, tenantId: context.tenantId },
        }),
      ]);
      if (
        !process ||
        process.version !== input.expectedProcessVersion ||
        !step ||
        step.version !== input.expectedStepVersion
      )
        throw new AppError(
          'FULFILLMENT_COMPENSATION_CONFLICT',
          'Process or step changed; refresh and retry',
          409,
          { retryable: true },
        );
      if (step.targetId)
        throw new AppError(
          'FULFILLMENT_COMPENSATION_TARGET_STATE_REQUIRED',
          'A created downstream object requires an explicit target-domain cancellation command; automatic compensation is not allowed',
          409,
        );
      assertProcessStepTransition(step.status, 'COMPENSATING');
      assertProcessTransition(process.status, 'COMPENSATING');
      await transaction.orderFulfillmentStep.update({
        data: {
          compensationSnapshot: json({
            reason: input.reason.trim(),
            targetCreated: false,
          }),
          status: 'COMPENSATING',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: step.id },
      });
      await transaction.orderFulfillmentProcess.update({
        data: {
          status: 'COMPENSATING',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: process.id },
      });
      assertProcessStepTransition('COMPENSATING', 'COMPENSATED');
      assertProcessTransition('COMPENSATING', 'FAILED');
      const changedStep = await transaction.orderFulfillmentStep.update({
        data: {
          status: 'COMPENSATED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: step.id },
      });
      const changedProcess = await transaction.orderFulfillmentProcess.update({
        data: {
          failureCode: 'DOWNSTREAM_STEP_COMPENSATED',
          failureMessage: input.reason.trim(),
          manualInterventionRequired: false,
          status: 'FAILED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: process.id },
      });
      await this.record(
        transaction,
        process.id,
        changedProcess.version,
        'oms.fulfillment-step-compensated.v1',
        context,
        metadata,
        { processId, reason: input.reason.trim(), stepId },
      );
      return {
        processStatus: changedProcess.status,
        processVersion: changedProcess.version,
        stepStatus: changedStep.status,
        stepVersion: changedStep.version,
      };
    });
  }

  private async failFromDeadLetter(
    message: BusinessEventInput,
    transaction: Prisma.TransactionClient,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const payload = object(message.payload);
    const sourceEventId = text(payload.eventId);
    const stepType = {
      'tms.shipment-request.v2': 'CREATE_TMS_ORDER',
      'wms.fulfillment-command.v2': 'CREATE_WMS_OUTBOUND',
    }[text(payload.consumer) ?? ''] as
      | 'CREATE_TMS_ORDER'
      | 'CREATE_WMS_OUTBOUND'
      | undefined;
    if (!sourceEventId || !isUuid(sourceEventId) || !stepType)
      return { eventId: message.eventId, status: 'IGNORED' };
    const step = await transaction.orderFulfillmentStep.findFirst({
      where: { sourceEventId, stepType, tenantId: context.tenantId },
    });
    if (!step || ['SUCCEEDED', 'COMPENSATED'].includes(step.status))
      return { eventId: message.eventId, status: 'IGNORED' };
    assertProcessStepTransition(step.status, 'MANUAL');
    const process = await transaction.orderFulfillmentProcess.findFirstOrThrow({
      where: { id: step.processId, tenantId: context.tenantId },
    });
    if (process.status !== 'MANUAL_INTERVENTION')
      assertProcessTransition(process.status, 'MANUAL_INTERVENTION');
    await transaction.orderFulfillmentStep.update({
      data: {
        attemptCount: { increment: 1 },
        lastError: text(payload.error) ?? 'Event delivery exhausted retries',
        status: 'MANUAL',
        updatedBy: context.accountId,
        version: { increment: 1 },
      },
      where: { id: step.id },
    });
    const changed = await transaction.orderFulfillmentProcess.update({
      data: {
        failureCode: 'DOWNSTREAM_DELIVERY_DEAD_LETTER',
        failureMessage:
          text(payload.error) ?? 'Downstream event delivery exhausted retries',
        manualInterventionRequired: true,
        status: 'MANUAL_INTERVENTION',
        updatedBy: context.accountId,
        version: { increment: 1 },
      },
      where: { id: process.id },
    });
    await this.record(
      transaction,
      changed.id,
      changed.version,
      'oms.fulfillment-process-failed.v1',
      context,
      metadata,
      {
        businessRef: changed.orderNo,
        code: changed.failureCode!,
        message: changed.failureMessage!,
        processId: changed.id,
        severity: 'HIGH',
        status: changed.status,
        stepId: step.id,
        summary: `Fulfillment process ${changed.orderNo} requires manual intervention`,
      },
    );
    return { processId: changed.id, status: changed.status, stepId: step.id };
  }

  private downstreamMatches(message: BusinessEventInput) {
    const payload = object(message.payload);
    const sourceRef = text(payload.sourceRef);
    if (message.eventType === 'outbound.created.v1') {
      if (!sourceRef || !isUuid(sourceRef)) return [];
      const targetId = text(payload.outboundId);
      if (!targetId || !isUuid(targetId)) return [];
      return [
        {
          sourceRef,
          stepType: 'CREATE_WMS_OUTBOUND' as const,
          targetBusinessNo: text(payload.outboundNo) ?? targetId,
          targetId,
          targetType: 'WMS_OUTBOUND',
        },
      ];
    }
    if (message.eventType === 'outbound.ready.v1') {
      if (!sourceRef || !isUuid(sourceRef)) return [];
      const targetId = text(payload.outboundId);
      if (!targetId || !isUuid(targetId)) return [];
      return [
        {
          sourceRef,
          stepType: 'WAIT_WMS_READY' as const,
          targetBusinessNo: text(payload.outboundNo) ?? targetId,
          targetId,
          targetType: 'WMS_OUTBOUND',
        },
      ];
    }
    if (message.eventType === 'tms.transport-order-received.v1') {
      if (!sourceRef || !isUuid(sourceRef)) return [];
      const targetId = text(payload.transportOrderId);
      if (!targetId || !isUuid(targetId)) return [];
      return [
        {
          sourceRef,
          stepType: 'CREATE_TMS_ORDER' as const,
          targetBusinessNo: text(payload.orderNo) ?? targetId,
          targetId,
          targetType: 'TMS_TRANSPORT_ORDER',
        },
      ];
    }
    const stepType = {
      'shipment.delivered.v1': 'WAIT_DELIVERY',
      'shipment.pod-confirmed.v1': 'FINALIZE_ORDER',
      'shipment.vehicle-assigned.v1': 'WAIT_DISPATCH',
    }[message.eventType] as
      'FINALIZE_ORDER' | 'WAIT_DELIVERY' | 'WAIT_DISPATCH' | undefined;
    if (!stepType || !Array.isArray(payload.sourceRefs)) return [];
    const shipmentId = text(payload.shipmentId);
    if (!shipmentId || !isUuid(shipmentId)) return [];
    return payload.sourceRefs.flatMap((value) => {
      const source = object(value);
      const ref = text(source.sourceRef);
      if (!ref || !isUuid(ref)) return [];
      return [
        {
          sourceRef: ref,
          stepType,
          targetBusinessNo: text(source.transportOrderNo) ?? shipmentId,
          targetId: shipmentId,
          targetType: 'TMS_SHIPMENT',
        },
      ];
    });
  }

  private async succeedStep(
    transaction: Prisma.TransactionClient,
    message: BusinessEventInput,
    match: ReturnType<FulfillmentProcessService['downstreamMatches']>[number],
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const step = await transaction.orderFulfillmentStep.findFirst({
      where: {
        idempotencyKey: { startsWith: `${match.sourceRef}:` },
        stepType: match.stepType,
        tenantId: context.tenantId,
      },
    });
    if (!step || step.status === 'SUCCEEDED') return null;
    assertProcessStepTransition(step.status, 'SUCCEEDED');
    const process = await transaction.orderFulfillmentProcess.findFirstOrThrow({
      where: { id: step.processId, tenantId: context.tenantId },
    });
    await transaction.orderFulfillmentStep.update({
      data: {
        attemptCount: { increment: 1 },
        lastError: null,
        resultSnapshot: json(message.payload),
        status: 'SUCCEEDED',
        targetBusinessNo: match.targetBusinessNo,
        targetId: match.targetId,
        targetType: match.targetType,
        updatedBy: context.accountId,
        version: { increment: 1 },
      },
      where: { id: step.id },
    });
    if (
      match.stepType === 'CREATE_WMS_OUTBOUND' ||
      match.stepType === 'CREATE_TMS_ORDER'
    ) {
      const input = object(step.inputSnapshot);
      const inputPayload = object(input.payload);
      const sourceType =
        match.stepType === 'CREATE_WMS_OUTBOUND'
          ? 'FULFILLMENT_ORDER'
          : 'SHIPMENT_REQUEST';
      await transaction.crossDomainObjectLink.upsert({
        create: {
          createdBy: context.accountId,
          processId: process.id,
          sourceBusinessNo:
            text(
              inputPayload.fulfillmentNo ?? inputPayload.shipmentRequestNo,
            ) ?? match.sourceRef,
          sourceId: match.sourceRef,
          sourceType,
          targetBusinessNo: match.targetBusinessNo,
          targetId: match.targetId,
          targetType: match.targetType,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
        update: {
          targetBusinessNo: match.targetBusinessNo,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: {
          tenantId_sourceType_sourceId_targetType_targetId: {
            sourceId: match.sourceRef,
            sourceType,
            targetId: match.targetId,
            targetType: match.targetType,
            tenantId: context.tenantId,
          },
        },
      });
      await this.projectDownstream(transaction, match, context);
    }
    const succeededStepCount = await transaction.orderFulfillmentStep.count({
      where: {
        processId: process.id,
        status: 'SUCCEEDED',
        tenantId: context.tenantId,
      },
    });
    const target =
      succeededStepCount === process.expectedStepCount
        ? 'COMPLETED'
        : 'EXECUTING';
    let currentStatus = process.status;
    if (currentStatus === 'WAITING_DOWNSTREAM') {
      assertProcessTransition(currentStatus, 'EXECUTING');
      await transaction.orderFulfillmentProcess.update({
        data: {
          status: 'EXECUTING',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: process.id },
      });
      currentStatus = 'EXECUTING';
    }
    if (currentStatus !== target)
      assertProcessTransition(currentStatus, target);
    const changed = await transaction.orderFulfillmentProcess.update({
      data: {
        ...(target === 'COMPLETED' ? { completedAt: new Date() } : {}),
        status: target,
        succeededStepCount,
        updatedBy: context.accountId,
        version: { increment: 1 },
      },
      where: { id: process.id },
    });
    await this.record(
      transaction,
      changed.id,
      changed.version,
      target === 'COMPLETED'
        ? 'oms.fulfillment-process-completed.v1'
        : 'oms.fulfillment-process-progressed.v1',
      context,
      metadata,
      {
        businessRef: changed.orderNo,
        processId: changed.id,
        status: changed.status,
        succeededStepCount,
      },
    );
    return {
      processId: changed.id,
      status: changed.status,
      stepId: step.id,
      succeededStepCount,
    };
  }

  private async projectDownstream(
    transaction: Prisma.TransactionClient,
    match: NonNullable<
      ReturnType<FulfillmentProcessService['downstreamMatches']>[number]
    >,
    context: TenantContext,
  ) {
    if (match.stepType === 'CREATE_WMS_OUTBOUND') {
      const row = await transaction.fulfillmentOrder.findFirst({
        where: { id: match.sourceRef, tenantId: context.tenantId },
      });
      if (row?.status === 'RELEASED')
        await transaction.fulfillmentOrder.update({
          data: {
            externalReference: match.targetBusinessNo,
            sourceVersion: { increment: 1 },
            status: 'ACCEPTED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: row.id },
        });
    } else {
      const row = await transaction.shipmentRequest.findFirst({
        where: { id: match.sourceRef, tenantId: context.tenantId },
      });
      if (row?.status === 'SUBMITTED')
        await transaction.shipmentRequest.update({
          data: {
            status: 'ACCEPTED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: row.id },
        });
    }
  }

  private async record(
    transaction: Prisma.TransactionClient,
    aggregateId: string,
    aggregateVersion: number,
    eventName: string,
    context: TenantContext,
    metadata: CommandMetadata,
    payload: Prisma.InputJsonObject,
  ) {
    await Promise.all([
      transaction.platformAuditLog.create({
        data: {
          action: eventName,
          after: payload,
          category: 'BUSINESS_CHANGE',
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          deviceId: context.deviceId,
          ipAddress: metadata.ipAddress ?? null,
          resourceId: aggregateId,
          resourceType: 'OrderFulfillmentProcess',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      transaction.platformOutbox.create({
        data: {
          aggregateId,
          aggregateType: 'OrderFulfillmentProcess',
          aggregateVersion,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          eventName,
          partitionKey: aggregateId,
          payload: { ...payload, tenantId: context.tenantId },
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
    ]);
  }

  private uuid(value: string, code: string) {
    if (!isUuid(value)) throw new AppError(code, 'Resource was not found', 404);
  }
}
