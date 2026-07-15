import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type ControlForecastStatus,
  type ControlLoadOptimizationStatus,
  type ControlNetworkScenarioStatus,
  type ControlRecommendationStatus,
  type ControlRouteOptimizationStatus,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { hashIdempotencyRequest } from '../platform/idempotency.service';
import { JobSchedulingFacade } from '../platform/public/job-scheduling.facade';
import type { CommandMetadata } from '../platform/tenant.service';
import { OptimizerSidecarClient } from './optimizer-sidecar.client';

type JsonObject = Record<string, unknown>;

export interface RouteOptimizationInput extends JsonObject {
  readonly distanceMatrix: readonly (readonly number[])[];
  readonly durationMatrix: readonly (readonly number[])[];
  readonly locations: readonly JsonObject[];
  readonly objective?: JsonObject;
  readonly organizationRef: string;
  readonly stops: readonly JsonObject[];
  readonly timeLimitSeconds?: number;
  readonly vehicles: readonly JsonObject[];
}

export interface LoadOptimizationInput extends JsonObject {
  readonly containers: readonly JsonObject[];
  readonly items: readonly JsonObject[];
  readonly organizationRef: string;
  readonly timeLimitSeconds?: number;
}

export interface DemandForecastInput extends JsonObject {
  readonly confidenceLevel: number;
  readonly dimensions: JsonObject;
  readonly granularity: 'DAY' | 'WEEK' | 'MONTH';
  readonly history: readonly JsonObject[];
  readonly horizon: number;
  readonly organizationRef: string;
  readonly trainingFrom: string;
  readonly trainingTo: string;
}

export interface InventoryRecommendationInput extends JsonObject {
  readonly currentInventory: JsonObject;
  readonly expiresAt?: string;
  readonly forecastId: string;
  readonly leadTimeDays: number;
  readonly organizationRef: string;
  readonly productId: string;
  readonly serviceLevel: number;
  readonly warehouseId: string;
}

export interface NetworkScenarioInput extends JsonObject {
  readonly baselineScenarioId?: string;
  readonly baselineSnapshot: JsonObject;
  readonly changes: JsonObject;
  readonly name: string;
  readonly organizationRef: string;
  readonly scenarioNo: string;
}

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
const object = (value: unknown): JsonObject =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const ROUTE_TRANSITIONS: Readonly<
  Record<ControlRouteOptimizationStatus, readonly ControlRouteOptimizationStatus[]>
> = {
  FAILED: ['RUNNING'],
  QUEUED: ['FAILED', 'RUNNING'],
  RUNNING: ['FAILED', 'SUCCEEDED'],
  SUCCEEDED: [],
};
const LOAD_TRANSITIONS: Readonly<
  Record<ControlLoadOptimizationStatus, readonly ControlLoadOptimizationStatus[]>
> = {
  CONFIRMED: [],
  FAILED: ['RUNNING'],
  PROPOSED: ['CONFIRMED', 'REJECTED'],
  QUEUED: ['FAILED', 'RUNNING'],
  REJECTED: [],
  RUNNING: ['FAILED', 'PROPOSED'],
};
const FORECAST_TRANSITIONS: Readonly<
  Record<ControlForecastStatus, readonly ControlForecastStatus[]>
> = { DRAFT: ['PUBLISHED'], PUBLISHED: ['RETIRED'], RETIRED: [] };
const RECOMMENDATION_TRANSITIONS: Readonly<
  Record<ControlRecommendationStatus, readonly ControlRecommendationStatus[]>
> = {
  ACCEPTED: [],
  EXPIRED: [],
  PROPOSED: ['ACCEPTED', 'EXPIRED', 'REJECTED'],
  REJECTED: [],
};
const SCENARIO_TRANSITIONS: Readonly<
  Record<ControlNetworkScenarioStatus, readonly ControlNetworkScenarioStatus[]>
> = {
  ARCHIVED: [],
  COMPLETED: ['ARCHIVED'],
  DRAFT: ['QUEUED'],
  FAILED: ['QUEUED', 'RUNNING'],
  QUEUED: ['FAILED', 'RUNNING'],
  RUNNING: ['COMPLETED', 'FAILED'],
};

@Injectable()
export class AiOptimizationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JobSchedulingFacade)
    private readonly scheduling: JobSchedulingFacade,
    @Inject(OptimizerSidecarClient)
    private readonly optimizer: OptimizerSidecarClient,
  ) {}

  async createRouteOptimization(
    input: RouteOptimizationInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.scope(input.organizationRef, context);
    const payload = this.routePayload(input);
    const id = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.controlRouteOptimization.create({
        data: {
          createdBy: context.accountId,
          id,
          inputSnapshot: json(payload),
          objectiveSnapshot: json(input.objective ?? { mode: 'MIN_DISTANCE_AND_VEHICLES' }),
          requestHash: hashIdempotencyRequest(payload),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(tx, id, 'RouteOptimization', 1, 'control.route-optimization-queued.v1', { status: 'QUEUED' }, context, metadata);
    });
    return this.enqueue('ROUTE', id, context, metadata);
  }

  async createLoadOptimization(
    input: LoadOptimizationInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.scope(input.organizationRef, context);
    const payload = this.loadPayload(input);
    const id = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.controlLoadOptimizationResult.create({
        data: {
          constraintSnapshot: {},
          createdBy: context.accountId,
          explanation: 'Pending OR-Tools execution',
          id,
          inputSnapshot: json(payload),
          placementSnapshot: [],
          requestHash: hashIdempotencyRequest(payload),
          solverVersion: 'ortools-9.14.6206',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(tx, id, 'LoadOptimizationResult', 1, 'control.load-optimization-queued.v1', { status: 'QUEUED' }, context, metadata);
    });
    return this.enqueue('LOAD', id, context, metadata);
  }

  async executeJob(
    input: { aggregateId: string; jobRunId: string; kind: 'LOAD' | 'NETWORK' | 'ROUTE' },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (!isUuid(input.aggregateId) || !isUuid(input.jobRunId) || !['LOAD', 'NETWORK', 'ROUTE'].includes(input.kind))
      this.invalid('Optimization job input is invalid');
    if (input.kind === 'ROUTE') return this.executeRoute(input.aggregateId, input.jobRunId, context, metadata);
    if (input.kind === 'LOAD') return this.executeLoad(input.aggregateId, input.jobRunId, context, metadata);
    return this.executeScenario(input.aggregateId, input.jobRunId, context, metadata);
  }

  async decideLoad(
    id: string,
    input: { decision: 'CONFIRMED' | 'REJECTED'; expectedVersion: number; reason: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const reason = this.text(input.reason, 'reason', 1000);
    return this.prisma.$transaction(async (tx) => {
      const current = await this.load(tx, id, context);
      this.version(current.version, input.expectedVersion);
      this.transition(LOAD_TRANSITIONS, current.status, input.decision, 'load optimization');
      const changed = await tx.controlLoadOptimizationResult.update({
        data: {
          ...(input.decision === 'CONFIRMED'
            ? { confirmedAt: new Date(), confirmedBy: context.accountId }
            : {}),
          decisionReason: reason,
          status: input.decision,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(tx, id, 'LoadOptimizationResult', changed.version, `control.load-optimization-${input.decision.toLowerCase()}.v1`, { reason, status: changed.status }, context, metadata);
      return toHttpJson(changed);
    });
  }

  async recordLoadDeviation(
    id: string,
    input: { actual: JsonObject; expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.boundedJson(input.actual, 'actual');
    return this.prisma.$transaction(async (tx) => {
      const current = await this.load(tx, id, context);
      this.version(current.version, input.expectedVersion);
      if (current.status !== 'CONFIRMED') this.conflict('Only confirmed load suggestions accept deviation feedback');
      if (current.actualDeviationSnapshot) this.conflict('Load deviation feedback is immutable once recorded');
      const changed = await tx.controlLoadOptimizationResult.update({
        data: {
          actualDeviationSnapshot: json(input.actual),
          deviationRecordedAt: new Date(),
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(tx, id, 'LoadOptimizationResult', changed.version, 'control.load-deviation-recorded.v1', { actual: input.actual, status: changed.status }, context, metadata);
      return toHttpJson(changed);
    });
  }

  async createForecast(
    input: DemandForecastInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.scope(input.organizationRef, context);
    const trainingFrom = this.date(input.trainingFrom, 'trainingFrom');
    const trainingTo = this.date(input.trainingTo, 'trainingTo');
    if (trainingTo <= trainingFrom) this.invalid('Forecast training window is invalid');
    if (!Number.isInteger(input.horizon) || input.horizon < 1 || input.horizon > 365)
      this.invalid('horizon must be 1..365');
    if (!['DAY', 'WEEK', 'MONTH'].includes(input.granularity)) this.invalid('granularity is invalid');
    const z = this.zScore(input.confidenceLevel);
    const dimension = this.forecastDimensions(input.dimensions, input.organizationRef);
    const seriesKey = hashIdempotencyRequest(dimension);
    const history = this.history(input.history, trainingFrom, trainingTo);
    const values = history.map((item) => item.baseQty);
    const window = values.slice(-Math.min(4, values.length));
    const mean = window.reduce((sum, value) => sum + value, 0) / window.length;
    const residuals = values.map((value) => value - mean);
    const deviation = Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / Math.max(1, residuals.length - 1));
    const conversionPoint = history.find((item) => item.qty > 0);
    const basePerOriginal = conversionPoint
      ? conversionPoint.baseQty / conversionPoint.qty
      : 1;
    const points = Array.from({ length: input.horizon }, (_, index) => {
      const point = Math.max(0, mean);
      return {
        at: this.advance(trainingTo, input.granularity, index + 1).toISOString(),
        baseQty: point.toFixed(6),
        qty: (point / basePerOriginal).toFixed(6),
        lowerBaseQty: Math.max(0, point - z * deviation).toFixed(6),
        upperBaseQty: (point + z * deviation).toFixed(6),
        baseUom: history[0]!.baseUom,
        packageSpecVersionId: history[0]!.packageSpecVersionId,
        uom: history[0]!.uom,
      };
    });
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:forecast:${seriesKey}`);
      const latest = await tx.controlDemandForecast.findFirst({
        orderBy: { versionNumber: 'desc' },
        where: { seriesKey, tenantId: context.tenantId },
      });
      const forecast = await tx.controlDemandForecast.create({
        data: {
          confidenceLevel: new Prisma.Decimal(String(input.confidenceLevel)),
          createdBy: context.accountId,
          dimensionSnapshot: json(dimension),
          granularity: input.granularity,
          horizon: input.horizon,
          metricSnapshot: json({
            algorithm: 'WEIGHTED_MOVING_AVERAGE_V1',
            historyCount: history.length,
            meanBaseQty: mean.toFixed(6),
            residualStdDevBaseQty: deviation.toFixed(6),
            trainingDataHash: hashIdempotencyRequest(input.history),
            trainingPoints: input.history,
          }),
          modelVersion: 'scm-wma-1.0.0',
          pointSnapshot: json(points),
          seriesKey,
          tenantId: context.tenantId,
          trainingFrom,
          trainingTo,
          updatedBy: context.accountId,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
        },
      });
      await this.record(tx, forecast.id, 'DemandForecast', forecast.version, 'control.demand-forecast-created.v1', { modelVersion: forecast.modelVersion, seriesKey, status: forecast.status, versionNumber: forecast.versionNumber }, context, metadata);
      return toHttpJson(forecast);
    });
  }

  async publishForecast(
    id: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const forecast = await this.forecast(tx, id, context);
      this.version(forecast.version, input.expectedVersion);
      this.transition(FORECAST_TRANSITIONS, forecast.status, 'PUBLISHED', 'demand forecast');
      await this.lock(tx, `${context.tenantId}:forecast:${forecast.seriesKey}`);
      const active = await tx.controlDemandForecast.findMany({
        where: { id: { not: id }, seriesKey: forecast.seriesKey, status: 'PUBLISHED', tenantId: context.tenantId },
      });
      for (const previous of active) {
        this.transition(FORECAST_TRANSITIONS, previous.status, 'RETIRED', 'demand forecast');
        const retired = await tx.controlDemandForecast.update({ data: { status: 'RETIRED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: previous.id } });
        await this.record(tx, retired.id, 'DemandForecast', retired.version, 'control.demand-forecast-retired.v1', { replacedById: id, status: retired.status }, context, metadata);
      }
      const changed = await tx.controlDemandForecast.update({
        data: { publishedAt: new Date(), status: 'PUBLISHED', updatedBy: context.accountId, version: { increment: 1 } },
        where: { id },
      });
      await this.record(tx, id, 'DemandForecast', changed.version, 'control.demand-forecast-published.v1', { status: changed.status, versionNumber: changed.versionNumber }, context, metadata);
      return toHttpJson(changed);
    });
  }

  async retireForecast(
    id: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.changeForecastStatus(id, input.expectedVersion, 'RETIRED', context, metadata);
  }

  async recordForecastDeviation(
    id: string,
    input: { actualPoints: readonly JsonObject[]; expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (!Array.isArray(input.actualPoints) || input.actualPoints.length < 1 || input.actualPoints.length > 365)
      this.invalid('actualPoints must contain 1..365 points');
    this.boundedJson(input.actualPoints, 'actualPoints');
    return this.prisma.$transaction(async (tx) => {
      const forecast = await this.forecast(tx, id, context);
      this.version(forecast.version, input.expectedVersion);
      if (forecast.status !== 'PUBLISHED') this.conflict('Only published forecasts accept actual deviation feedback');
      const changed = await tx.controlDemandForecast.update({
        data: { actualDeviationSnapshot: json(input.actualPoints), updatedBy: context.accountId, version: { increment: 1 } },
        where: { id },
      });
      await this.record(tx, id, 'DemandForecast', changed.version, 'control.demand-forecast-deviation-recorded.v1', { pointCount: input.actualPoints.length, status: changed.status }, context, metadata);
      return toHttpJson(changed);
    });
  }

  async createInventoryRecommendation(
    input: InventoryRecommendationInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.scope(input.organizationRef, context);
    if (!isUuid(input.forecastId) || !isUuid(input.productId) || !isUuid(input.warehouseId))
      this.invalid('Recommendation references are invalid');
    if (!Number.isInteger(input.leadTimeDays) || input.leadTimeDays < 1 || input.leadTimeDays > 365)
      this.invalid('leadTimeDays must be 1..365');
    const z = this.zScore(input.serviceLevel);
    const expiresAt = input.expiresAt ? this.date(input.expiresAt, 'expiresAt') : null;
    this.inventorySnapshot(input.currentInventory);
    return this.prisma.$transaction(async (tx) => {
      const forecast = await this.forecast(tx, input.forecastId, context);
      if (forecast.status !== 'PUBLISHED') this.conflict('Inventory recommendations require a published forecast');
      const metrics = object(forecast.metricSnapshot);
      const mean = this.number(metrics.meanBaseQty, 'forecast.meanBaseQty', 0);
      const deviation = this.number(metrics.residualStdDevBaseQty, 'forecast.residualStdDevBaseQty', 0);
      const safetyStock = z * deviation * Math.sqrt(input.leadTimeDays);
      const reorderPoint = mean * input.leadTimeDays + safetyStock;
      const currentBaseQty = this.number(input.currentInventory.baseQty, 'currentInventory.baseQty', 0);
      const suggestedOrder = Math.max(0, reorderPoint + mean * 7 - currentBaseQty);
      const policy = {
        action: suggestedOrder > 0 ? 'REPLENISH' : 'HOLD',
        baseUom: this.text(input.currentInventory.baseUom, 'currentInventory.baseUom', 30),
        reorderPointBaseQty: reorderPoint.toFixed(6),
        safetyStockBaseQty: safetyStock.toFixed(6),
        suggestedOrderBaseQty: suggestedOrder.toFixed(6),
        transferSuggestion: object(input.currentInventory.transferCandidate),
      };
      const recommendation = await tx.controlInventoryPolicyRecommendation.create({
        data: {
          createdBy: context.accountId,
          expiresAt,
          explanation: `Service level ${input.serviceLevel} with ${input.leadTimeDays}-day lead time; recommendation is advisory and does not mutate inventory.`,
          forecastId: input.forecastId,
          inputSnapshot: json({ currentInventory: input.currentInventory, leadTimeDays: input.leadTimeDays, serviceLevel: input.serviceLevel }),
          policySnapshot: json(policy),
          productId: input.productId,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          warehouseId: input.warehouseId,
        },
      });
      await this.record(tx, recommendation.id, 'InventoryPolicyRecommendation', recommendation.version, 'control.inventory-policy-recommendation-created.v1', { forecastId: input.forecastId, policy, status: recommendation.status }, context, metadata);
      return toHttpJson(recommendation);
    });
  }

  async decideRecommendation(
    id: string,
    input: { decision: 'ACCEPTED' | 'EXPIRED' | 'REJECTED'; expectedVersion: number; reason: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const reason = this.text(input.reason, 'reason', 1000);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.controlInventoryPolicyRecommendation.findFirst({ where: { id, tenantId: context.tenantId } });
      if (!current) this.notFound('Inventory recommendation');
      this.version(current.version, input.expectedVersion);
      this.transition(RECOMMENDATION_TRANSITIONS, current.status, input.decision, 'inventory recommendation');
      const changed = await tx.controlInventoryPolicyRecommendation.update({
        data: { decidedAt: new Date(), decidedBy: context.accountId, decisionReason: reason, status: input.decision, updatedBy: context.accountId, version: { increment: 1 } },
        where: { id },
      });
      await this.record(tx, id, 'InventoryPolicyRecommendation', changed.version, `control.inventory-policy-recommendation-${input.decision.toLowerCase()}.v1`, { policy: changed.policySnapshot, reason, status: changed.status }, context, metadata);
      return toHttpJson(changed);
    });
  }

  async createScenario(
    input: NetworkScenarioInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.scope(input.organizationRef, context);
    const scenarioNo = this.code(input.scenarioNo, 'scenarioNo');
    const name = this.text(input.name, 'name', 200);
    this.networkSnapshot(input.baselineSnapshot);
    this.boundedJson(input.changes, 'changes');
    if (input.baselineScenarioId && !isUuid(input.baselineScenarioId)) this.invalid('baselineScenarioId is invalid');
    return this.prisma.$transaction(async (tx) => {
      if (input.baselineScenarioId) {
        const baseline = await tx.controlNetworkScenario.findFirst({ where: { id: input.baselineScenarioId, status: 'COMPLETED', tenantId: context.tenantId } });
        if (!baseline) this.conflict('Baseline scenario must be completed and tenant-scoped');
      }
      const scenario = await tx.controlNetworkScenario.create({
        data: {
          baselineScenarioId: input.baselineScenarioId ?? null,
          baselineSnapshot: json(input.baselineSnapshot),
          changeSnapshot: json(input.changes),
          createdBy: context.accountId,
          name,
          scenarioNo,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(tx, scenario.id, 'NetworkScenario', scenario.version, 'control.network-scenario-created.v1', { scenarioNo, status: scenario.status }, context, metadata);
      return toHttpJson(scenario);
    });
  }

  async runScenario(
    id: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const queued = await this.prisma.$transaction(async (tx) => {
      const scenario = await this.scenario(tx, id, context);
      this.version(scenario.version, input.expectedVersion);
      this.transition(SCENARIO_TRANSITIONS, scenario.status, 'QUEUED', 'network scenario');
      const changed = await tx.controlNetworkScenario.update({ data: { failureCode: null, status: 'QUEUED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
      await this.record(tx, id, 'NetworkScenario', changed.version, 'control.network-scenario-queued.v1', { status: changed.status }, context, metadata);
      return changed;
    });
    return this.enqueue('NETWORK', queued.id, context, metadata);
  }

  async archiveScenario(
    id: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const scenario = await this.scenario(tx, id, context);
      this.version(scenario.version, input.expectedVersion);
      this.transition(SCENARIO_TRANSITIONS, scenario.status, 'ARCHIVED', 'network scenario');
      const changed = await tx.controlNetworkScenario.update({ data: { status: 'ARCHIVED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
      await this.record(tx, id, 'NetworkScenario', changed.version, 'control.network-scenario-archived.v1', { status: changed.status }, context, metadata);
      return toHttpJson(changed);
    });
  }

  async exportScenario(id: string, context: TenantContext) {
    const result = await this.prisma.controlSimulationResult.findFirst({ where: { scenarioId: id, tenantId: context.tenantId } });
    if (!result) this.notFound('Simulation result');
    return toHttpJson({ export: result.exportSnapshot, resultId: result.id, scenarioId: id });
  }

  async workbench(context: TenantContext) {
    const [routes, routeResults, loads, forecasts, recommendations, scenarios, simulationResults] = await Promise.all([
      this.prisma.controlRouteOptimization.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100, where: { tenantId: context.tenantId } }),
      this.prisma.controlRouteOptimizationResult.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100, where: { tenantId: context.tenantId } }),
      this.prisma.controlLoadOptimizationResult.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100, where: { tenantId: context.tenantId } }),
      this.prisma.controlDemandForecast.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100, where: { tenantId: context.tenantId } }),
      this.prisma.controlInventoryPolicyRecommendation.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100, where: { tenantId: context.tenantId } }),
      this.prisma.controlNetworkScenario.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100, where: { tenantId: context.tenantId } }),
      this.prisma.controlSimulationResult.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100, where: { tenantId: context.tenantId } }),
    ]);
    return toHttpJson({ forecasts, loads, recommendations, routeResults, routes, scenarios, simulationResults });
  }

  private async enqueue(
    kind: 'LOAD' | 'NETWORK' | 'ROUTE',
    aggregateId: string,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    try {
      const run = await this.scheduling.enqueueAiOptimization({ aggregateId, kind }, context, metadata);
      await this.prisma.$transaction(async (tx) => {
        if (kind === 'ROUTE') {
          const current = await tx.controlRouteOptimization.findUniqueOrThrow({ where: { id: aggregateId } });
          const changed = await tx.controlRouteOptimization.update({ data: { jobRunId: run.jobRunId, updatedBy: context.accountId, version: { increment: 1 } }, where: { id: aggregateId } });
          await this.record(tx, aggregateId, 'RouteOptimization', changed.version, 'control.route-optimization-job-linked.v1', { jobRunId: run.jobRunId, status: current.status }, context, metadata);
        } else if (kind === 'LOAD') {
          const changed = await tx.controlLoadOptimizationResult.update({ data: { jobRunId: run.jobRunId, updatedBy: context.accountId, version: { increment: 1 } }, where: { id: aggregateId } });
          await this.record(tx, aggregateId, 'LoadOptimizationResult', changed.version, 'control.load-optimization-job-linked.v1', { jobRunId: run.jobRunId, status: changed.status }, context, metadata);
        } else {
          const changed = await tx.controlNetworkScenario.update({ data: { jobRunId: run.jobRunId, updatedBy: context.accountId, version: { increment: 1 } }, where: { id: aggregateId } });
          await this.record(tx, aggregateId, 'NetworkScenario', changed.version, 'control.network-scenario-job-linked.v1', { jobRunId: run.jobRunId, status: changed.status }, context, metadata);
        }
      });
      return { accepted: true, aggregateId, jobId: run.jobRunId, status: 'QUEUED' };
    } catch (error) {
      await this.failScheduling(kind, aggregateId, context, metadata);
      throw error;
    }
  }

  private async executeRoute(id: string, jobRunId: string, context: TenantContext, metadata: CommandMetadata) {
    const current = await this.prisma.controlRouteOptimization.findFirst({ where: { id, tenantId: context.tenantId } });
    if (!current) this.notFound('Route optimization');
    if (current.status === 'SUCCEEDED') {
      const result = await this.prisma.controlRouteOptimizationResult.findFirst({ where: { optimizationId: id, tenantId: context.tenantId } });
      return toHttpJson({ duplicate: true, optimizationId: id, result });
    }
    const started = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:route-optimization:${id}`);
      const fresh = await this.route(tx, id, context);
      if (fresh.status === 'RUNNING' || fresh.status === 'SUCCEEDED') return false;
      this.transition(ROUTE_TRANSITIONS, fresh.status, 'RUNNING', 'route optimization');
      const changed = await tx.controlRouteOptimization.update({ data: { jobRunId, startedAt: new Date(), status: 'RUNNING', updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
      await this.record(tx, id, 'RouteOptimization', changed.version, 'control.route-optimization-started.v1', { jobRunId, status: changed.status }, context, metadata);
      return true;
    });
    if (!started) return { duplicate: true, optimizationId: id, status: 'RUNNING' };
    try {
      const result = await this.optimizer.solveRoutes(object(current.inputSnapshot));
      return await this.prisma.$transaction(async (tx) => {
        const fresh = await this.route(tx, id, context);
        this.transition(ROUTE_TRANSITIONS, fresh.status, 'SUCCEEDED', 'route optimization');
        const saved = await tx.controlRouteOptimizationResult.create({
          data: {
            constraintSnapshot: json(result.constraints),
            createdBy: context.accountId,
            explanation: String(result.explanation),
            feasibility: String(result.status),
            objectiveValue: result.objectiveValue === null || result.objectiveValue === undefined ? null : new Prisma.Decimal(String(result.objectiveValue)),
            optimizationId: id,
            resultHash: hashIdempotencyRequest(result),
            routeSnapshot: json(result.routes ?? []),
            solver: String(result.solver),
            solverVersion: String(result.solverVersion),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        const changed = await tx.controlRouteOptimization.update({ data: { completedAt: new Date(), status: 'SUCCEEDED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
        await this.record(tx, id, 'RouteOptimization', changed.version, 'control.route-optimization-completed.v1', { feasibility: saved.feasibility, resultId: saved.id, status: changed.status }, context, metadata);
        return toHttpJson({ optimizationId: id, resultId: saved.id, status: changed.status });
      });
    } catch (error) {
      await this.failExecution('ROUTE', id, context, metadata, error);
      throw error;
    }
  }

  private async executeLoad(id: string, jobRunId: string, context: TenantContext, metadata: CommandMetadata) {
    const current = await this.prisma.controlLoadOptimizationResult.findFirst({ where: { id, tenantId: context.tenantId } });
    if (!current) this.notFound('Load optimization');
    if (['PROPOSED', 'CONFIRMED', 'REJECTED'].includes(current.status)) return { duplicate: true, loadOptimizationId: id, status: current.status };
    const started = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:load-optimization:${id}`);
      const fresh = await this.load(tx, id, context);
      if (fresh.status === 'RUNNING' || ['PROPOSED', 'CONFIRMED', 'REJECTED'].includes(fresh.status)) return false;
      this.transition(LOAD_TRANSITIONS, fresh.status, 'RUNNING', 'load optimization');
      const changed = await tx.controlLoadOptimizationResult.update({ data: { jobRunId, startedAt: new Date(), status: 'RUNNING', updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
      await this.record(tx, id, 'LoadOptimizationResult', changed.version, 'control.load-optimization-started.v1', { jobRunId, status: changed.status }, context, metadata);
      return true;
    });
    if (!started) return { duplicate: true, loadOptimizationId: id, status: 'RUNNING' };
    try {
      const result = await this.optimizer.solveLoad(object(current.inputSnapshot));
      return await this.prisma.$transaction(async (tx) => {
        const fresh = await this.load(tx, id, context);
        this.transition(LOAD_TRANSITIONS, fresh.status, 'PROPOSED', 'load optimization');
        const changed = await tx.controlLoadOptimizationResult.update({
          data: {
            completedAt: new Date(),
            constraintSnapshot: json(result.constraints),
            explanation: String(result.explanation),
            placementSnapshot: json(result.placements ?? []),
            solverVersion: String(result.solverVersion),
            status: 'PROPOSED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id },
        });
        await this.record(tx, id, 'LoadOptimizationResult', changed.version, 'control.load-optimization-proposed.v1', { feasibility: result.status, status: changed.status }, context, metadata);
        return toHttpJson({ loadOptimizationId: id, status: changed.status });
      });
    } catch (error) {
      await this.failExecution('LOAD', id, context, metadata, error);
      throw error;
    }
  }

  private async executeScenario(id: string, jobRunId: string, context: TenantContext, metadata: CommandMetadata) {
    const current = await this.prisma.controlNetworkScenario.findFirst({ where: { id, tenantId: context.tenantId } });
    if (!current) this.notFound('Network scenario');
    if (current.status === 'COMPLETED') {
      const result = await this.prisma.controlSimulationResult.findFirst({ where: { scenarioId: id, tenantId: context.tenantId } });
      return toHttpJson({ duplicate: true, result, scenarioId: id });
    }
    const started = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:network-scenario:${id}`);
      const fresh = await this.scenario(tx, id, context);
      if (fresh.status === 'RUNNING' || fresh.status === 'COMPLETED') return false;
      this.transition(SCENARIO_TRANSITIONS, fresh.status, 'RUNNING', 'network scenario');
      const changed = await tx.controlNetworkScenario.update({ data: { jobRunId, startedAt: new Date(), status: 'RUNNING', updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
      await this.record(tx, id, 'NetworkScenario', changed.version, 'control.network-scenario-started.v1', { jobRunId, status: changed.status }, context, metadata);
      return true;
    });
    if (!started) return { duplicate: true, scenarioId: id, status: 'RUNNING' };
    try {
      const metrics = this.simulate(object(current.baselineSnapshot), object(current.changeSnapshot));
      const baselineResult = current.baselineScenarioId
        ? await this.prisma.controlSimulationResult.findFirst({ where: { scenarioId: current.baselineScenarioId, tenantId: context.tenantId } })
        : null;
      const comparison = this.compareSimulation(object(baselineResult?.metricSnapshot), metrics);
      const exported = { comparison, generatedAt: new Date().toISOString(), metrics, scenario: { id, name: current.name, scenarioNo: current.scenarioNo } };
      return await this.prisma.$transaction(async (tx) => {
        const fresh = await this.scenario(tx, id, context);
        this.transition(SCENARIO_TRANSITIONS, fresh.status, 'COMPLETED', 'network scenario');
        const result = await tx.controlSimulationResult.create({
          data: {
            comparisonSnapshot: json(comparison),
            createdBy: context.accountId,
            explanation: `Scenario demand ${metrics.demandBaseQty}, usable capacity ${metrics.usableCapacityBaseQty}, unmet ${metrics.unmetBaseQty}.`,
            exportSnapshot: json(exported),
            metricSnapshot: json(metrics),
            resultHash: hashIdempotencyRequest(exported),
            scenarioId: id,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        const changed = await tx.controlNetworkScenario.update({ data: { completedAt: new Date(), status: 'COMPLETED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
        await this.record(tx, id, 'NetworkScenario', changed.version, 'control.network-scenario-completed.v1', { resultId: result.id, status: changed.status }, context, metadata);
        return toHttpJson({ resultId: result.id, scenarioId: id, status: changed.status });
      });
    } catch (error) {
      await this.failExecution('NETWORK', id, context, metadata, error);
      throw error;
    }
  }

  private async changeForecastStatus(
    id: string,
    expectedVersion: number,
    target: 'RETIRED',
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const forecast = await this.forecast(tx, id, context);
      this.version(forecast.version, expectedVersion);
      this.transition(FORECAST_TRANSITIONS, forecast.status, target, 'demand forecast');
      const changed = await tx.controlDemandForecast.update({
        data: { status: target, updatedBy: context.accountId, version: { increment: 1 } },
        where: { id },
      });
      await this.record(tx, id, 'DemandForecast', changed.version, 'control.demand-forecast-retired.v1', { status: changed.status }, context, metadata);
      return toHttpJson(changed);
    });
  }

  private async failScheduling(
    kind: 'LOAD' | 'NETWORK' | 'ROUTE',
    id: string,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    await this.prisma.$transaction(async (tx) => {
      if (kind === 'ROUTE') {
        const current = await this.route(tx, id, context);
        this.transition(ROUTE_TRANSITIONS, current.status, 'FAILED', 'route optimization');
        const changed = await tx.controlRouteOptimization.update({ data: { failureCode: 'JOB_SCHEDULING_FAILED', status: 'FAILED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
        await this.record(tx, id, 'RouteOptimization', changed.version, 'control.route-optimization-failed.v1', { failureCode: changed.failureCode, status: changed.status }, context, metadata);
      } else if (kind === 'LOAD') {
        const current = await this.load(tx, id, context);
        this.transition(LOAD_TRANSITIONS, current.status, 'FAILED', 'load optimization');
        const changed = await tx.controlLoadOptimizationResult.update({ data: { failureCode: 'JOB_SCHEDULING_FAILED', status: 'FAILED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
        await this.record(tx, id, 'LoadOptimizationResult', changed.version, 'control.load-optimization-failed.v1', { failureCode: changed.failureCode, status: changed.status }, context, metadata);
      } else {
        const current = await this.scenario(tx, id, context);
        this.transition(SCENARIO_TRANSITIONS, current.status, 'FAILED', 'network scenario');
        const changed = await tx.controlNetworkScenario.update({ data: { failureCode: 'JOB_SCHEDULING_FAILED', status: 'FAILED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
        await this.record(tx, id, 'NetworkScenario', changed.version, 'control.network-scenario-failed.v1', { failureCode: changed.failureCode, status: changed.status }, context, metadata);
      }
    });
  }

  private async failExecution(
    kind: 'LOAD' | 'NETWORK' | 'ROUTE',
    id: string,
    context: TenantContext,
    metadata: CommandMetadata,
    error: unknown,
  ) {
    const failureCode = error instanceof AppError ? error.code : 'OPTIMIZATION_EXECUTION_FAILED';
    await this.prisma.$transaction(async (tx) => {
      if (kind === 'ROUTE') {
        const current = await this.route(tx, id, context);
        if (current.status !== 'RUNNING') return;
        this.transition(ROUTE_TRANSITIONS, current.status, 'FAILED', 'route optimization');
        const changed = await tx.controlRouteOptimization.update({ data: { completedAt: new Date(), failureCode, status: 'FAILED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
        await this.record(tx, id, 'RouteOptimization', changed.version, 'control.route-optimization-failed.v1', { failureCode, status: changed.status }, context, metadata);
      } else if (kind === 'LOAD') {
        const current = await this.load(tx, id, context);
        if (current.status !== 'RUNNING') return;
        this.transition(LOAD_TRANSITIONS, current.status, 'FAILED', 'load optimization');
        const changed = await tx.controlLoadOptimizationResult.update({ data: { completedAt: new Date(), failureCode, status: 'FAILED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
        await this.record(tx, id, 'LoadOptimizationResult', changed.version, 'control.load-optimization-failed.v1', { failureCode, status: changed.status }, context, metadata);
      } else {
        const current = await this.scenario(tx, id, context);
        if (current.status !== 'RUNNING') return;
        this.transition(SCENARIO_TRANSITIONS, current.status, 'FAILED', 'network scenario');
        const changed = await tx.controlNetworkScenario.update({ data: { completedAt: new Date(), failureCode, status: 'FAILED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
        await this.record(tx, id, 'NetworkScenario', changed.version, 'control.network-scenario-failed.v1', { failureCode, status: changed.status }, context, metadata);
      }
    });
  }

  private routePayload(input: RouteOptimizationInput): JsonObject {
    if (!Array.isArray(input.locations) || input.locations.length < 2 || input.locations.length > 500)
      this.invalid('locations must contain 2..500 entries');
    if (!Array.isArray(input.vehicles) || input.vehicles.length < 1 || input.vehicles.length > 100)
      this.invalid('vehicles must contain 1..100 entries');
    if (!Array.isArray(input.stops) || input.stops.length !== input.locations.length - 1)
      this.invalid('stops must match non-depot locations');
    this.matrix(input.distanceMatrix, input.locations.length, 'distanceMatrix');
    this.matrix(input.durationMatrix, input.locations.length, 'durationMatrix');
    if (input.timeLimitSeconds !== undefined && (!Number.isInteger(input.timeLimitSeconds) || input.timeLimitSeconds < 1 || input.timeLimitSeconds > 30))
      this.invalid('timeLimitSeconds must be 1..30');
    const payload = {
      distanceMatrix: input.distanceMatrix,
      durationMatrix: input.durationMatrix,
      locations: input.locations,
      requestId: randomUUID(),
      stops: input.stops,
      timeLimitSeconds: input.timeLimitSeconds ?? 5,
      vehicles: input.vehicles,
    };
    this.boundedJson(payload, 'route optimization');
    return payload;
  }

  private loadPayload(input: LoadOptimizationInput): JsonObject {
    if (!Array.isArray(input.containers) || input.containers.length < 1 || input.containers.length > 100)
      this.invalid('containers must contain 1..100 entries');
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 500)
      this.invalid('items must contain 1..500 entries');
    if (input.timeLimitSeconds !== undefined && (!Number.isInteger(input.timeLimitSeconds) || input.timeLimitSeconds < 1 || input.timeLimitSeconds > 30))
      this.invalid('timeLimitSeconds must be 1..30');
    const payload = {
      containers: input.containers,
      items: input.items,
      requestId: randomUUID(),
      timeLimitSeconds: input.timeLimitSeconds ?? 5,
    };
    this.boundedJson(payload, 'load optimization');
    return payload;
  }

  private forecastDimensions(value: unknown, organizationRef: string) {
    const dimensions = object(value);
    const productId = this.text(dimensions.productId, 'dimensions.productId', 100);
    if (!isUuid(productId)) this.invalid('dimensions.productId is invalid');
    const customerId = dimensions.customerId ? this.text(dimensions.customerId, 'dimensions.customerId', 100) : null;
    const region = dimensions.region ? this.text(dimensions.region, 'dimensions.region', 100) : null;
    return { customerId, organizationRef, productId, region };
  }

  private history(values: readonly JsonObject[], from: Date, to: Date) {
    if (!Array.isArray(values) || values.length < 2 || values.length > 730)
      this.invalid('history must contain 2..730 points');
    let baseUom: string | undefined;
    let packageVersion: string | undefined;
    let uom: string | undefined;
    const parsed = values.map((raw, index) => {
      const at = this.date(raw.at, `history[${index}].at`);
      if (at < from || at > to) this.invalid('Forecast history falls outside the training window');
      const packageSpecVersionId = this.text(raw.packageSpecVersionId, `history[${index}].packageSpecVersionId`, 100);
      if (!isUuid(packageSpecVersionId)) this.invalid('Forecast history packageSpecVersionId is invalid');
      if (packageVersion && packageVersion !== packageSpecVersionId) this.invalid('Forecast history package specification versions must be consistent');
      packageVersion = packageSpecVersionId;
      const pointBaseUom = this.text(raw.baseUom, `history[${index}].baseUom`, 30);
      if (baseUom && baseUom !== pointBaseUom) this.invalid('Forecast history base units must be consistent');
      baseUom = pointBaseUom;
      const pointUom = this.text(raw.uom, `history[${index}].uom`, 30);
      if (uom && uom !== pointUom) this.invalid('Forecast history original units must be consistent');
      uom = pointUom;
      const baseQty = this.number(raw.baseQty, `history[${index}].baseQty`, 0);
      const qty = this.number(raw.qty, `history[${index}].qty`, 0);
      if ((qty === 0) !== (baseQty === 0))
        this.invalid('Forecast history original and base quantities must both be zero or non-zero');
      return {
        at,
        baseQty,
        baseUom: pointBaseUom,
        packageSpecVersionId,
        qty,
        uom: pointUom,
      };
    }).sort((left, right) => left.at.getTime() - right.at.getTime());
    const ratios = parsed
      .filter((item) => item.qty > 0)
      .map((item) => item.baseQty / item.qty);
    if (
      ratios.length > 1 &&
      ratios.some((ratio) => Math.abs(ratio - ratios[0]!) > 0.000001)
    )
      this.invalid('Forecast history quantity conversion must match the package version');
    return parsed;
  }

  private inventorySnapshot(value: JsonObject) {
    this.number(value.baseQty, 'currentInventory.baseQty', 0);
    this.number(value.qty, 'currentInventory.qty', 0);
    this.text(value.baseUom, 'currentInventory.baseUom', 30);
    this.text(value.uom, 'currentInventory.uom', 30);
    const versionId = this.text(value.packageSpecVersionId, 'currentInventory.packageSpecVersionId', 100);
    if (!isUuid(versionId)) this.invalid('currentInventory.packageSpecVersionId is invalid');
    if (value.unitHoldingCost) this.money(value.unitHoldingCost, 'currentInventory.unitHoldingCost');
    if (value.unitOrderingCost) this.money(value.unitOrderingCost, 'currentInventory.unitOrderingCost');
    if (value.shelfLifeDays !== undefined) this.number(value.shelfLifeDays, 'currentInventory.shelfLifeDays', 1);
    this.boundedJson(value, 'currentInventory');
  }

  private networkSnapshot(value: JsonObject) {
    const warehouses = array(value.warehouses);
    if (warehouses.length < 1 || warehouses.length > 100) this.invalid('baselineSnapshot.warehouses must contain 1..100 entries');
    let currency: string | undefined;
    for (const [index, raw] of warehouses.entries()) {
      const warehouse = object(raw);
      this.text(warehouse.id, `warehouses[${index}].id`, 100);
      if (typeof warehouse.open !== 'boolean') this.invalid('warehouse.open must be boolean');
      this.number(warehouse.capacityBaseQty, `warehouses[${index}].capacityBaseQty`, 0);
      const money = this.money(warehouse.fixedCost, `warehouses[${index}].fixedCost`);
      if (currency && currency !== money.currency) this.invalid('Network costs must share one currency');
      currency = money.currency;
      this.number(warehouse.slaMinutes, `warehouses[${index}].slaMinutes`, 1);
    }
    this.number(value.carrierCapacityBaseQty, 'baselineSnapshot.carrierCapacityBaseQty', 0);
    this.number(value.demandBaseQty, 'baselineSnapshot.demandBaseQty', 0);
    const variable = this.money(value.variableCost, 'baselineSnapshot.variableCost');
    if (currency !== variable.currency) this.invalid('Network costs must share one currency');
    this.boundedJson(value, 'baselineSnapshot');
  }

  private simulate(baseline: JsonObject, changes: JsonObject) {
    this.networkSnapshot(baseline);
    const overrides = new Map(
      array(changes.warehouseOverrides).map((raw) => {
        const value = object(raw);
        return [String(value.id), value] as const;
      }),
    );
    const warehouses = array(baseline.warehouses).map((raw) => {
      const value = object(raw);
      const override = overrides.get(String(value.id)) ?? {};
      return {
        capacity: this.number(override.capacityBaseQty ?? value.capacityBaseQty, 'capacityBaseQty', 0),
        fixedCost: this.money(value.fixedCost, 'fixedCost'),
        id: String(value.id),
        open: typeof override.open === 'boolean' ? override.open : Boolean(value.open),
        slaMinutes: this.number(override.slaMinutes ?? value.slaMinutes, 'slaMinutes', 1),
      };
    });
    const demandMultiplier = changes.demandMultiplier === undefined ? 1 : this.number(changes.demandMultiplier, 'changes.demandMultiplier', 0);
    const variableMultiplier = changes.variableCostMultiplier === undefined ? 1 : this.number(changes.variableCostMultiplier, 'changes.variableCostMultiplier', 0);
    const carrierDelta = changes.carrierCapacityDeltaBaseQty === undefined ? 0 : this.number(changes.carrierCapacityDeltaBaseQty, 'changes.carrierCapacityDeltaBaseQty', -1_000_000_000);
    const demand = this.number(baseline.demandBaseQty, 'demandBaseQty', 0) * demandMultiplier;
    const warehouseCapacity = warehouses.filter((item) => item.open).reduce((sum, item) => sum + item.capacity, 0);
    const carrierCapacity = Math.max(0, this.number(baseline.carrierCapacityBaseQty, 'carrierCapacityBaseQty', 0) + carrierDelta);
    const usable = Math.min(warehouseCapacity, carrierCapacity);
    const fulfilled = Math.min(demand, usable);
    const unmet = Math.max(0, demand - fulfilled);
    const variableCost = this.money(baseline.variableCost, 'variableCost');
    const fixed = warehouses.filter((item) => item.open).reduce((sum, item) => sum.plus(item.fixedCost.amount), new Prisma.Decimal(0));
    const total = fixed.plus(new Prisma.Decimal(variableCost.amount).mul(fulfilled).mul(variableMultiplier));
    const slaTarget = changes.slaTargetMinutes === undefined ? Number.POSITIVE_INFINITY : this.number(changes.slaTargetMinutes, 'changes.slaTargetMinutes', 1);
    const riskyNodes = warehouses.filter((item) => item.open && item.slaMinutes > slaTarget).length;
    return {
      currency: variableCost.currency,
      demandBaseQty: demand.toFixed(6),
      fulfilledBaseQty: fulfilled.toFixed(6),
      openWarehouseCount: warehouses.filter((item) => item.open).length,
      slaRiskNodeCount: riskyNodes,
      totalCost: { amount: total.toFixed(6), currency: variableCost.currency },
      unmetBaseQty: unmet.toFixed(6),
      usableCapacityBaseQty: usable.toFixed(6),
    };
  }

  private compareSimulation(baseline: JsonObject, current: JsonObject) {
    if (Object.keys(baseline).length === 0) return { baselineAvailable: false };
    const baselineCost = this.money(baseline.totalCost, 'baseline.totalCost');
    const currentCost = this.money(current.totalCost, 'current.totalCost');
    if (baselineCost.currency !== currentCost.currency) this.invalid('Simulation currencies cannot be compared');
    return {
      baselineAvailable: true,
      costDelta: { amount: new Prisma.Decimal(currentCost.amount).minus(baselineCost.amount).toFixed(6), currency: currentCost.currency },
      unmetBaseQtyDelta: (this.number(current.unmetBaseQty, 'current.unmetBaseQty', 0) - this.number(baseline.unmetBaseQty, 'baseline.unmetBaseQty', 0)).toFixed(6),
    };
  }

  private money(value: unknown, field: string) {
    const item = object(value);
    const currency = this.text(item.currency, `${field}.currency`, 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) this.invalid(`${field}.currency is invalid`);
    let amount: Prisma.Decimal;
    try {
      amount = new Prisma.Decimal(String(item.amount));
    } catch {
      this.invalid(`${field}.amount is invalid`);
    }
    if (!amount.isFinite() || amount.isNegative()) this.invalid(`${field}.amount is invalid`);
    return { amount: amount.toFixed(6), currency };
  }

  private matrix(value: readonly (readonly number[])[], size: number, field: string) {
    if (!Array.isArray(value) || value.length !== size || value.some((row) => !Array.isArray(row) || row.length !== size || row.some((item) => !Number.isInteger(item) || item < 0)))
      this.invalid(`${field} must be a non-negative ${size}x${size} integer matrix`);
  }

  private advance(date: Date, granularity: 'DAY' | 'MONTH' | 'WEEK', amount: number) {
    const result = new Date(date);
    if (granularity === 'DAY') result.setUTCDate(result.getUTCDate() + amount);
    else if (granularity === 'WEEK') result.setUTCDate(result.getUTCDate() + amount * 7);
    else result.setUTCMonth(result.getUTCMonth() + amount);
    return result;
  }

  private zScore(value: unknown) {
    const accepted = new Map([[0.8, 1.281552], [0.9, 1.644854], [0.95, 1.959964], [0.99, 2.575829]]);
    const result = accepted.get(Number(value));
    if (!result) this.invalid('confidence/service level must be 0.8, 0.9, 0.95 or 0.99');
    return result;
  }

  private async route(tx: Prisma.TransactionClient, id: string, context: TenantContext) {
    const result = await tx.controlRouteOptimization.findFirst({ where: { id, tenantId: context.tenantId } });
    if (!result) this.notFound('Route optimization');
    return result;
  }

  private async load(tx: Prisma.TransactionClient, id: string, context: TenantContext) {
    const result = await tx.controlLoadOptimizationResult.findFirst({ where: { id, tenantId: context.tenantId } });
    if (!result) this.notFound('Load optimization');
    return result;
  }

  private async forecast(tx: Prisma.TransactionClient, id: string, context: TenantContext) {
    const result = await tx.controlDemandForecast.findFirst({ where: { id, tenantId: context.tenantId } });
    if (!result) this.notFound('Demand forecast');
    return result;
  }

  private async scenario(tx: Prisma.TransactionClient, id: string, context: TenantContext) {
    const result = await tx.controlNetworkScenario.findFirst({ where: { id, tenantId: context.tenantId } });
    if (!result) this.notFound('Network scenario');
    return result;
  }

  private transition<S extends string>(map: Readonly<Record<S, readonly S[]>>, current: S, target: S, label: string) {
    if (!map[current].includes(target)) this.conflict(`${label} transition ${current} -> ${target} is not allowed`);
  }

  private version(current: number, expected: number) {
    if (!Number.isInteger(expected) || current !== expected)
      throw new AppError('CONTROL_AI_VERSION_CONFLICT', 'The optimization version is stale', 409, { retryable: true });
  }

  private scope(organizationRef: unknown, context: TenantContext) {
    const reference = this.text(organizationRef, 'organizationRef', 100);
    if (context.organizationIds.length > 0 && !context.organizationIds.includes(reference))
      throw new AppError('CONTROL_AI_SCOPE_DENIED', 'The organization is outside the caller data scope', 403);
  }

  private boundedJson(value: unknown, field: string) {
    if (Buffer.byteLength(JSON.stringify(value)) > 2_000_000) this.invalid(`${field} exceeds the 2 MB snapshot limit`);
  }

  private date(value: unknown, field: string) {
    const result = new Date(String(value));
    if (Number.isNaN(result.getTime())) this.invalid(`${field} is invalid`);
    return result;
  }

  private number(value: unknown, field: string, minimum: number) {
    const result = Number(value);
    if (!Number.isFinite(result) || result < minimum) this.invalid(`${field} is invalid`);
    return result;
  }

  private code(value: unknown, field: string) {
    const result = this.text(value, field, 100).toUpperCase();
    if (!/^[A-Z][A-Z0-9_.-]{2,99}$/.test(result)) this.invalid(`${field} is invalid`);
    return result;
  }

  private text(value: unknown, field: string, maximum: number) {
    const result = typeof value === 'string' ? value.trim() : '';
    if (!result || result.length > maximum) this.invalid(`${field} is invalid`);
    return result;
  }

  private lock(tx: Prisma.TransactionClient, key: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }

  private async record(
    tx: Prisma.TransactionClient,
    id: string,
    type: string,
    version: number,
    eventName: string,
    payload: Readonly<Record<string, unknown>>,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const after = json(payload) as Prisma.InputJsonObject;
    await Promise.all([
      tx.platformAuditLog.create({
        data: {
          action: eventName,
          after,
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
          eventName,
          partitionKey: id,
          payload: { ...after, tenantId: context.tenantId },
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
    ]);
  }

  private invalid(message: string): never {
    throw new AppError('CONTROL_AI_INPUT_INVALID', message, 400);
  }

  private conflict(message: string): never {
    throw new AppError('CONTROL_AI_STATE_CONFLICT', message, 409);
  }

  private notFound(label: string): never {
    throw new AppError('CONTROL_AI_NOT_FOUND', `${label} was not found`, 404);
  }
}
