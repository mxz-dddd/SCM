import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type ControlMetricGranularity,
  type ControlReportVisibility,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { PrismaService } from '../../database/prisma.service';
import type { BusinessEventInput } from '../platform/event.service';
import { hashIdempotencyRequest } from '../platform/idempotency.service';
import { EventConsumptionFacade } from '../platform/public/event-consumption.facade';
import type { CommandMetadata } from '../platform/tenant.service';

type JsonObject = Record<string, unknown>;
type FormulaOperator = 'AVERAGE' | 'COUNT' | 'RATIO' | 'SUM';

export interface PublishMetricInput {
  readonly code: string;
  readonly dataSources: readonly string[];
  readonly dimensions: readonly string[];
  readonly formula: {
    readonly operands: readonly string[];
    readonly operator: FormulaOperator;
  };
  readonly granularity: ControlMetricGranularity;
  readonly name: string;
  readonly refreshPolicy: {
    readonly mode: 'EVENT' | 'SCHEDULED';
    readonly seconds: number;
  };
  readonly sensitiveDimensions?: readonly string[];
  readonly timeZone: string;
}

export interface ObserveMetricInput {
  readonly components: Readonly<Record<string, string>>;
  readonly dimensions: Readonly<Record<string, string>>;
  readonly periodEnd: string;
  readonly periodStart: string;
  readonly source?: Readonly<Record<string, unknown>>;
}

export interface PublishDashboardInput {
  readonly code: string;
  readonly layout?: Readonly<Record<string, unknown>>;
  readonly name: string;
  readonly organizationRef?: string;
  readonly refreshSeconds: number;
  readonly warehouseRef?: string;
  readonly widgets: readonly {
    readonly config?: Readonly<Record<string, unknown>>;
    readonly key: string;
    readonly metricCode?: string;
    readonly position: Readonly<Record<string, number>>;
    readonly title: string;
    readonly type:
      'ALERT' | 'CARD' | 'FUNNEL' | 'MAP' | 'RANKING' | 'TICKER' | 'TREND';
  }[];
}

export interface PublishReportInput {
  readonly code: string;
  readonly dimensions: readonly string[];
  readonly exportPolicy: {
    readonly allowed: boolean;
    readonly maxRows: number;
  };
  readonly filters?: readonly {
    readonly field: string;
    readonly operator: 'EQ';
    readonly value: string;
  }[];
  readonly maskingFields?: readonly string[];
  readonly metricCodes: readonly string[];
  readonly name: string;
  readonly quota: {
    readonly dailyCost: number;
    readonly dailyExports: number;
    readonly dailyQueries: number;
    readonly maxRows: number;
  };
  readonly semanticModel: 'CONTROL_METRICS';
  readonly shareWith?: readonly string[];
  readonly visibility: ControlReportVisibility;
}

const ALLOWED_DIMENSIONS = new Set([
  'carrierRef',
  'customerRef',
  'date',
  'organizationRef',
  'productRef',
  'regionRef',
  'routeRef',
  'serviceType',
  'warehouseRef',
]);
const object = (value: unknown): JsonObject =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;

@Injectable()
export class BiAnalyticsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventConsumptionFacade)
    private readonly events: EventConsumptionFacade,
  ) {}

  async publishMetric(
    input: PublishMetricInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.assertMetric(input);
    const code = this.code(input.code, 'metric code');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:metric:${code}`);
      let definition = await tx.controlMetricDefinition.findUnique({
        where: { tenantId_code: { code, tenantId: context.tenantId } },
      });
      const latest = definition
        ? await tx.controlMetricDefinitionVersion.aggregate({
            _max: { versionNumber: true },
            where: {
              metricDefinitionId: definition.id,
              tenantId: context.tenantId,
            },
          })
        : null;
      const versionNumber = (latest?._max.versionNumber ?? 0) + 1;
      if (!definition)
        definition = await tx.controlMetricDefinition.create({
          data: {
            code,
            createdBy: context.accountId,
            name: this.text(input.name, 'name', 200),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      const metricVersion = await tx.controlMetricDefinitionVersion.create({
        data: {
          createdBy: context.accountId,
          dataSourceSnapshot: json({ dataSources: input.dataSources }),
          dimensionSnapshot: json({ dimensions: input.dimensions }),
          formulaSnapshot: json(input.formula),
          granularity: input.granularity,
          metricDefinitionId: definition.id,
          refreshPolicySnapshot: json(input.refreshPolicy),
          sensitiveDimensionSnapshot: json({
            dimensions: input.sensitiveDimensions ?? [],
          }),
          tenantId: context.tenantId,
          timeZone: input.timeZone,
          updatedBy: context.accountId,
          versionNumber,
        },
      });
      const published = await tx.controlMetricDefinition.update({
        data: {
          activeVersionNumber: versionNumber,
          name: input.name.trim(),
          status: 'PUBLISHED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: definition.id },
      });
      await this.record(
        tx,
        definition.id,
        'ControlMetricDefinition',
        published.version,
        'control.metric-published.v1',
        { code, metricVersionId: metricVersion.id, versionNumber },
        context,
        metadata,
      );
      return {
        code,
        metricDefinitionId: definition.id,
        metricVersionId: metricVersion.id,
        status: published.status,
        version: published.version,
        versionNumber,
      };
    });
  }

  async observeMetric(
    codeInput: string,
    input: ObserveMetricInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const code = this.code(codeInput, 'metric code');
    const periodStart = this.date(input.periodStart, 'periodStart');
    const periodEnd = this.date(input.periodEnd, 'periodEnd');
    if (periodEnd <= periodStart) this.invalid('Metric period is invalid');
    return this.prisma.$transaction(async (tx) => {
      const definition = await tx.controlMetricDefinition.findUnique({
        where: { tenantId_code: { code, tenantId: context.tenantId } },
      });
      if (!definition || definition.status !== 'PUBLISHED')
        throw new AppError(
          'CONTROL_METRIC_NOT_FOUND',
          'Published metric definition was not found',
          404,
        );
      const metricVersion = await tx.controlMetricDefinitionVersion.findFirst({
        where: {
          metricDefinitionId: definition.id,
          tenantId: context.tenantId,
          versionNumber: definition.activeVersionNumber!,
        },
      });
      if (!metricVersion)
        throw new AppError(
          'CONTROL_METRIC_VERSION_NOT_FOUND',
          'Metric version was not found',
          404,
        );
      this.assertDimensions(
        Object.keys(input.dimensions),
        strings(object(metricVersion.dimensionSnapshot).dimensions),
      );
      const value = this.calculate(
        metricVersion.formulaSnapshot,
        input.components,
      );
      const dimensionHash = hashIdempotencyRequest(input.dimensions);
      await this.lock(
        tx,
        `${context.tenantId}:metric-observation:${metricVersion.id}:${periodStart.toISOString()}:${periodEnd.toISOString()}:${dimensionHash}`,
      );
      const existing = await tx.controlMetricObservation.findUnique({
        where: {
          tenantId_metricVersionId_periodStart_periodEnd_dimensionHash: {
            dimensionHash,
            metricVersionId: metricVersion.id,
            periodEnd,
            periodStart,
            tenantId: context.tenantId,
          },
        },
      });
      if (existing) {
        if (
          hashIdempotencyRequest(existing.componentSnapshot) !==
            hashIdempotencyRequest(input.components) ||
          !existing.value.eq(value)
        )
          throw new AppError(
            'CONTROL_METRIC_OBSERVATION_CONFLICT',
            'The metric grain already has different content',
            409,
          );
        return {
          duplicate: true,
          metricObservationId: existing.id,
          metricVersionId: metricVersion.id,
          value: existing.value.toString(),
        };
      }
      const observation = await tx.controlMetricObservation.create({
        data: {
          componentSnapshot: json(input.components),
          createdBy: context.accountId,
          dimensionHash,
          dimensionSnapshot: json(input.dimensions),
          metricVersionId: metricVersion.id,
          periodEnd,
          periodStart,
          sourceSnapshot: json(input.source),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          value,
        },
      });
      await this.record(
        tx,
        observation.id,
        'ControlMetricObservation',
        observation.version,
        'control.metric-observed.v1',
        {
          code,
          metricVersionId: metricVersion.id,
          periodEnd: periodEnd.toISOString(),
          periodStart: periodStart.toISOString(),
          value: value.toString(),
        },
        context,
        metadata,
      );
      return {
        duplicate: false,
        metricObservationId: observation.id,
        metricVersionId: metricVersion.id,
        value: value.toString(),
      };
    });
  }

  async publishDashboard(
    input: PublishDashboardInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.assertDashboard(input);
    const code = this.code(input.code, 'dashboard code');
    const metricCodes = [
      ...new Set(
        input.widgets
          .map(({ metricCode }) => metricCode?.trim().toUpperCase())
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    return this.prisma.$transaction(async (tx) => {
      const metrics = await tx.controlMetricDefinition.findMany({
        where: {
          code: { in: metricCodes },
          status: 'PUBLISHED',
          tenantId: context.tenantId,
        },
      });
      if (metrics.length !== metricCodes.length)
        throw new AppError(
          'CONTROL_DASHBOARD_METRIC_INVALID',
          'Every dashboard metric must be published',
          409,
        );
      await this.lock(tx, `${context.tenantId}:dashboard:${code}`);
      let dashboard = await tx.controlDashboard.findUnique({
        where: { tenantId_code: { code, tenantId: context.tenantId } },
      });
      const latest = dashboard
        ? await tx.controlDashboardVersion.aggregate({
            _max: { versionNumber: true },
            where: { dashboardId: dashboard.id, tenantId: context.tenantId },
          })
        : null;
      const versionNumber = (latest?._max.versionNumber ?? 0) + 1;
      if (!dashboard)
        dashboard = await tx.controlDashboard.create({
          data: {
            code,
            createdBy: context.accountId,
            name: this.text(input.name, 'name', 200),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      const dashboardVersion = await tx.controlDashboardVersion.create({
        data: {
          createdBy: context.accountId,
          dashboardId: dashboard.id,
          layoutSnapshot: json(input.layout),
          organizationRef:
            this.optionalText(input.organizationRef, 200) ?? null,
          refreshSeconds: input.refreshSeconds,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          versionNumber,
          warehouseRef: this.optionalText(input.warehouseRef, 200) ?? null,
        },
      });
      for (const widget of input.widgets)
        await tx.controlDashboardWidgetConfig.create({
          data: {
            configSnapshot: json(widget.config),
            createdBy: context.accountId,
            dashboardVersionId: dashboardVersion.id,
            metricCode: widget.metricCode?.trim().toUpperCase() ?? null,
            positionSnapshot: json(widget.position),
            tenantId: context.tenantId,
            title: widget.title.trim(),
            updatedBy: context.accountId,
            widgetKey: widget.key.trim().toUpperCase(),
            widgetType: widget.type,
          },
        });
      const published = await tx.controlDashboard.update({
        data: {
          activeVersionNumber: versionNumber,
          name: input.name.trim(),
          status: 'PUBLISHED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: dashboard.id },
      });
      await this.record(
        tx,
        dashboard.id,
        'ControlDashboard',
        published.version,
        'control.dashboard-published.v1',
        { code, dashboardVersionId: dashboardVersion.id, versionNumber },
        context,
        metadata,
      );
      return {
        dashboardId: dashboard.id,
        dashboardVersionId: dashboardVersion.id,
        status: published.status,
        version: published.version,
        versionNumber,
      };
    });
  }

  async dashboard(
    codeInput: string,
    selection: { organizationRef?: string; warehouseRef?: string },
    context: TenantContext,
  ) {
    const code = this.code(codeInput, 'dashboard code');
    const dashboard = await this.prisma.controlDashboard.findUnique({
      where: { tenantId_code: { code, tenantId: context.tenantId } },
    });
    if (!dashboard || dashboard.status !== 'PUBLISHED')
      throw new AppError(
        'CONTROL_DASHBOARD_NOT_FOUND',
        'Published dashboard was not found',
        404,
      );
    const versions = await this.prisma.controlDashboardVersion.findMany({
      orderBy: { versionNumber: 'desc' },
      where: {
        dashboardId: dashboard.id,
        tenantId: context.tenantId,
        versionNumber: dashboard.activeVersionNumber!,
      },
    });
    const version = versions.find(
      (item) =>
        (!item.organizationRef ||
          item.organizationRef === selection.organizationRef) &&
        (!item.warehouseRef || item.warehouseRef === selection.warehouseRef),
    );
    if (!version)
      throw new AppError(
        'CONTROL_DASHBOARD_CONTEXT_DENIED',
        'Dashboard is not available for this organization or warehouse',
        403,
      );
    const widgets = await this.prisma.controlDashboardWidgetConfig.findMany({
      orderBy: [{ widgetKey: 'asc' }, { id: 'asc' }],
      where: { dashboardVersionId: version.id, tenantId: context.tenantId },
    });
    const metricCodes = widgets
      .map(({ metricCode }) => metricCode)
      .filter((value): value is string => Boolean(value));
    const definitions = await this.prisma.controlMetricDefinition.findMany({
      where: { code: { in: metricCodes }, tenantId: context.tenantId },
    });
    const metricVersions =
      await this.prisma.controlMetricDefinitionVersion.findMany({
        where: {
          OR: definitions.map((definition) => ({
            metricDefinitionId: definition.id,
            versionNumber: definition.activeVersionNumber!,
          })),
          tenantId: context.tenantId,
        },
      });
    const observations = await this.prisma.controlMetricObservation.findMany({
      orderBy: [{ periodEnd: 'desc' }, { id: 'desc' }],
      take: 1000,
      where: {
        metricVersionId: { in: metricVersions.map(({ id }) => id) },
        tenantId: context.tenantId,
      },
    });
    return toHttpJson({
      code,
      dashboardId: dashboard.id,
      dashboardVersionId: version.id,
      layout: version.layoutSnapshot,
      metricDefinitions: definitions,
      metricVersions,
      nextRefreshAt: new Date(Date.now() + version.refreshSeconds * 1000),
      observations,
      refreshSeconds: version.refreshSeconds,
      versionNumber: version.versionNumber,
      widgets,
    });
  }

  async publishReport(
    input: PublishReportInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.assertReport(input);
    const code = this.code(input.code, 'report code');
    const metricCodes = [
      ...new Set(
        input.metricCodes.map((item) => this.code(item, 'metric code')),
      ),
    ];
    return this.prisma.$transaction(async (tx) => {
      const definitions = await tx.controlMetricDefinition.findMany({
        where: {
          code: { in: metricCodes },
          status: 'PUBLISHED',
          tenantId: context.tenantId,
        },
      });
      if (definitions.length !== metricCodes.length)
        throw new AppError(
          'CONTROL_REPORT_METRIC_INVALID',
          'Every report metric must be published',
          409,
        );
      const versions = await tx.controlMetricDefinitionVersion.findMany({
        where: {
          OR: definitions.map((definition) => ({
            metricDefinitionId: definition.id,
            versionNumber: definition.activeVersionNumber!,
          })),
          tenantId: context.tenantId,
        },
      });
      await this.lock(tx, `${context.tenantId}:report:${code}`);
      let report = await tx.controlReportDefinition.findUnique({
        where: { tenantId_code: { code, tenantId: context.tenantId } },
      });
      const latest = report
        ? await tx.controlReportDefinitionVersion.aggregate({
            _max: { versionNumber: true },
            where: {
              reportDefinitionId: report.id,
              tenantId: context.tenantId,
            },
          })
        : null;
      const versionNumber = (latest?._max.versionNumber ?? 0) + 1;
      if (!report)
        report = await tx.controlReportDefinition.create({
          data: {
            code,
            createdBy: context.accountId,
            name: this.text(input.name, 'name', 200),
            ownerRef: context.accountId,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            visibility: input.visibility,
          },
        });
      const metricVersionSnapshot = definitions.map((definition) => {
        const version = versions.find(
          (item) => item.metricDefinitionId === definition.id,
        )!;
        return {
          code: definition.code,
          metricDefinitionId: definition.id,
          metricVersionId: version.id,
          versionNumber: version.versionNumber,
        };
      });
      const reportVersion = await tx.controlReportDefinitionVersion.create({
        data: {
          createdBy: context.accountId,
          dimensionSnapshot: json({ dimensions: input.dimensions }),
          exportPolicySnapshot: json(input.exportPolicy),
          filterSnapshot: json({ filters: input.filters ?? [] }),
          maskingSnapshot: json({ fields: input.maskingFields ?? [] }),
          metricVersionSnapshot: json(metricVersionSnapshot),
          quotaSnapshot: json(input.quota),
          reportDefinitionId: report.id,
          semanticModel: input.semanticModel,
          shareSnapshot: json({ accountRefs: input.shareWith ?? [] }),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          versionNumber,
        },
      });
      const published = await tx.controlReportDefinition.update({
        data: {
          activeVersionNumber: versionNumber,
          name: input.name.trim(),
          status: 'PUBLISHED',
          updatedBy: context.accountId,
          version: { increment: 1 },
          visibility: input.visibility,
        },
        where: { id: report.id },
      });
      await this.record(
        tx,
        report.id,
        'ControlReportDefinition',
        published.version,
        'control.report-published.v1',
        { code, reportVersionId: reportVersion.id, versionNumber },
        context,
        metadata,
      );
      return {
        reportId: report.id,
        reportVersionId: reportVersion.id,
        status: published.status,
        version: published.version,
        versionNumber,
      };
    });
  }

  async runQuery(
    reportId: string,
    input: {
      filters?: Readonly<Record<string, string>>;
      rowLimit: number;
    },
    context: TenantContext,
    options: { exportRequested: boolean; sensitiveAccess: boolean },
  ) {
    if (!Number.isInteger(input.rowLimit) || input.rowLimit < 1)
      this.invalid('rowLimit is invalid');
    const result = await this.prisma.$transaction(async (tx) => {
      const report = await tx.controlReportDefinition.findFirst({
        where: {
          id: reportId,
          status: 'PUBLISHED',
          tenantId: context.tenantId,
        },
      });
      if (!report)
        throw new AppError(
          'CONTROL_REPORT_NOT_FOUND',
          'Published report was not found',
          404,
        );
      const shared = strings(
        object(
          (
            await tx.controlReportDefinitionVersion.findFirst({
              where: {
                reportDefinitionId: report.id,
                tenantId: context.tenantId,
                versionNumber: report.activeVersionNumber!,
              },
            })
          )?.shareSnapshot,
        ).accountRefs,
      );
      if (
        report.visibility === 'PRIVATE' &&
        report.ownerRef !== context.accountId &&
        !shared.includes(context.accountId)
      )
        throw new AppError(
          'CONTROL_REPORT_ACCESS_DENIED',
          'Private report is not shared with this account',
          403,
        );
      const version = await tx.controlReportDefinitionVersion.findFirstOrThrow({
        where: {
          reportDefinitionId: report.id,
          tenantId: context.tenantId,
          versionNumber: report.activeVersionNumber!,
        },
      });
      const quota = object(version.quotaSnapshot);
      const exportPolicy = object(version.exportPolicySnapshot);
      const maxRows = Math.min(Number(quota.maxRows), input.rowLimit);
      if (
        !Number.isInteger(maxRows) ||
        maxRows < 1 ||
        input.rowLimit > Number(quota.maxRows)
      )
        throw this.quota('CONTROL_QUERY_ROW_QUOTA_EXCEEDED');
      if (
        options.exportRequested &&
        (!exportPolicy.allowed || input.rowLimit > Number(exportPolicy.maxRows))
      )
        throw this.quota('CONTROL_QUERY_EXPORT_POLICY_DENIED');
      const metricRefs = Array.isArray(version.metricVersionSnapshot)
        ? version.metricVersionSnapshot.map(object)
        : [];
      const allowedDimensions = strings(
        object(version.dimensionSnapshot).dimensions,
      );
      const filters = { ...object(input.filters) };
      this.assertDimensions(Object.keys(filters), allowedDimensions);
      const estimatedCost =
        Math.max(1, metricRefs.length) *
        Math.max(1, allowedDimensions.length) *
        Math.max(1, Object.keys(filters).length + 1) *
        input.rowLimit;
      const quotaDate = new Date();
      quotaDate.setUTCHours(0, 0, 0, 0);
      await this.lock(
        tx,
        `${context.tenantId}:analytics-quota:${context.accountId}:${quotaDate.toISOString()}`,
      );
      const bucket = await tx.controlAnalyticsQuotaBucket.findUnique({
        where: {
          tenantId_accountId_quotaDate: {
            accountId: context.accountId,
            quotaDate,
            tenantId: context.tenantId,
          },
        },
      });
      if (
        (bucket?.queryCount ?? 0) >= Number(quota.dailyQueries) ||
        (bucket?.costUsed ?? 0) + estimatedCost > Number(quota.dailyCost) ||
        (options.exportRequested &&
          (bucket?.exportCount ?? 0) >= Number(quota.dailyExports))
      )
        throw this.quota('CONTROL_QUERY_DAILY_QUOTA_EXCEEDED');
      const job = await tx.controlQueryJob.create({
        data: {
          createdBy: context.accountId,
          estimatedCost,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          exportRequested: options.exportRequested,
          maskedFieldSnapshot: json([]),
          queryHash: hashIdempotencyRequest({
            filters,
            reportId,
            version: version.id,
          }),
          reportVersionId: version.id,
          requestedBy: context.accountId,
          resultSnapshot: json({}),
          rowLimit: input.rowLimit,
          sensitiveAccess: options.sensitiveAccess,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const observations = await tx.controlMetricObservation.findMany({
        orderBy: [{ periodStart: 'asc' }, { id: 'asc' }],
        take: input.rowLimit,
        where: {
          metricVersionId: {
            in: metricRefs.map((item) => String(item.metricVersionId)),
          },
          tenantId: context.tenantId,
        },
      });
      const maskingFields = options.sensitiveAccess
        ? []
        : strings(object(version.maskingSnapshot).fields);
      const rows = observations
        .filter((observation) => {
          const dimensions = object(observation.dimensionSnapshot);
          return Object.entries(filters).every(
            ([field, value]) =>
              String(dimensions[field] ?? '') === String(value),
          );
        })
        .slice(0, input.rowLimit)
        .map((observation) => {
          const dimensions = { ...object(observation.dimensionSnapshot) };
          for (const field of maskingFields)
            if (field in dimensions) dimensions[field] = '***';
          const metric = metricRefs.find(
            (item) => item.metricVersionId === observation.metricVersionId,
          );
          return {
            dimensions,
            metricCode: metric?.code ?? 'UNKNOWN',
            metricVersion: metric?.versionNumber ?? null,
            periodEnd: observation.periodEnd,
            periodStart: observation.periodStart,
            value: observation.value.toString(),
          };
        });
      const completed = await tx.controlQueryJob.update({
        data: {
          completedAt: new Date(),
          maskedFieldSnapshot: json(maskingFields),
          resultSnapshot: json({ rows }),
          rowCount: rows.length,
          status: 'COMPLETED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: job.id },
      });
      await tx.controlAnalyticsQuotaBucket.upsert({
        create: {
          accountId: context.accountId,
          costUsed: estimatedCost,
          createdBy: context.accountId,
          exportCount: options.exportRequested ? 1 : 0,
          queryCount: 1,
          quotaDate,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
        update: {
          costUsed: { increment: estimatedCost },
          exportCount: { increment: options.exportRequested ? 1 : 0 },
          queryCount: { increment: 1 },
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: {
          tenantId_accountId_quotaDate: {
            accountId: context.accountId,
            quotaDate,
            tenantId: context.tenantId,
          },
        },
      });
      return {
        jobId: completed.id,
        maskedFields: maskingFields,
        reportVersion: version.versionNumber,
        rowCount: completed.rowCount,
        rows,
        status: completed.status,
      };
    });
    return toHttpJson(result);
  }

  consumeLakeEvent(
    event: BusinessEventInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.events.consumeControlLake(
      event,
      context,
      metadata,
      async (message, tx) => {
        const payload = object(message.payload);
        const lake = object(payload.lake);
        const dataset = this.dataset(lake.dataset);
        const recordType = String(lake.recordType ?? '').toUpperCase();
        if (!['DIMENSION', 'FACT'].includes(recordType))
          this.invalid('lake.recordType is invalid');
        const occurredAt = this.date(message.occurredAt, 'occurredAt');
        await this.lock(tx, `${context.tenantId}:lake-watermark:${dataset}`);
        const watermark = await tx.controlLakeWatermark.findUnique({
          where: { tenantId_dataset: { dataset, tenantId: context.tenantId } },
        });
        const late = Boolean(
          watermark &&
          occurredAt.getTime() < watermark.lastOccurredAt.getTime(),
        );
        const ingestedAt = new Date();
        let snapshotId: string;
        if (recordType === 'FACT') {
          const fact = await tx.controlLakeFactSnapshot.create({
            data: {
              aggregateId: message.aggregateId,
              aggregateType: message.aggregateType,
              aggregateVersion: message.aggregateVersion,
              arrivalStatus: late ? 'LATE' : 'ON_TIME',
              businessRef: this.text(
                lake.businessRef ?? payload.businessRef ?? message.aggregateId,
                'businessRef',
                200,
              ),
              createdBy: context.accountId,
              dataset,
              eventId: message.eventId,
              eventType: message.eventType,
              ingestedAt,
              isolationKey: 'ONLINE',
              occurredAt,
              recordSnapshot: json(lake.record),
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          snapshotId = fact.id;
        } else {
          const dimension = await tx.controlLakeDimensionSnapshot.create({
            data: {
              arrivalStatus: late ? 'LATE' : 'ON_TIME',
              createdBy: context.accountId,
              dataset,
              dimensionKey: this.text(lake.dimensionKey, 'dimensionKey', 200),
              effectiveAt: occurredAt,
              eventId: message.eventId,
              ingestedAt,
              isolationKey: 'ONLINE',
              recordSnapshot: json(lake.record),
              sourceVersion: message.aggregateVersion,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          snapshotId = dimension.id;
        }
        await tx.controlLakeWatermark.upsert({
          create: {
            createdBy: context.accountId,
            dataset,
            lastIngestedAt: ingestedAt,
            lastOccurredAt: occurredAt,
            lateRecordCount: late ? 1 : 0,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
          update: {
            lastIngestedAt: ingestedAt,
            lastOccurredAt:
              watermark && watermark.lastOccurredAt > occurredAt
                ? watermark.lastOccurredAt
                : occurredAt,
            lateRecordCount: { increment: late ? 1 : 0 },
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { tenantId_dataset: { dataset, tenantId: context.tenantId } },
        });
        return {
          arrivalStatus: late ? 'LATE' : 'ON_TIME',
          dataset,
          recordType,
          snapshotId,
        };
      },
    );
  }

  async recomputeLake(
    input: { dataset: string; fromAt: string; toAt: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const dataset = this.dataset(input.dataset);
    const fromAt = this.date(input.fromAt, 'fromAt');
    const toAt = this.date(input.toAt, 'toAt');
    if (toAt <= fromAt) this.invalid('Recompute range is invalid');
    return this.prisma.$transaction(async (tx) => {
      const isolationKey = `RECOMPUTE-${randomUUID()}`;
      const run = await tx.controlLakeRecomputeRun.create({
        data: {
          createdBy: context.accountId,
          dataset,
          fromAt,
          isolationKey,
          sourceSnapshot: json({ fromAt, toAt }),
          tenantId: context.tenantId,
          toAt,
          updatedBy: context.accountId,
        },
      });
      const [facts, dimensions] = await Promise.all([
        tx.controlLakeFactSnapshot.findMany({
          where: {
            dataset,
            isolationKey: 'ONLINE',
            occurredAt: { gte: fromAt, lt: toAt },
            tenantId: context.tenantId,
          },
        }),
        tx.controlLakeDimensionSnapshot.findMany({
          where: {
            dataset,
            effectiveAt: { gte: fromAt, lt: toAt },
            isolationKey: 'ONLINE',
            tenantId: context.tenantId,
          },
        }),
      ]);
      if (facts.length > 0)
        await tx.controlLakeFactSnapshot.createMany({
          data: facts.map((row) => ({
            aggregateId: row.aggregateId,
            aggregateType: row.aggregateType,
            aggregateVersion: row.aggregateVersion,
            arrivalStatus: row.arrivalStatus,
            businessRef: row.businessRef,
            createdBy: context.accountId,
            dataset,
            eventId: row.eventId,
            eventType: row.eventType,
            ingestedAt: new Date(),
            isolationKey,
            occurredAt: row.occurredAt,
            recomputeRunId: run.id,
            recordSnapshot: json(row.recordSnapshot),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          })),
        });
      if (dimensions.length > 0)
        await tx.controlLakeDimensionSnapshot.createMany({
          data: dimensions.map((row) => ({
            arrivalStatus: row.arrivalStatus,
            createdBy: context.accountId,
            dataset,
            dimensionKey: row.dimensionKey,
            effectiveAt: row.effectiveAt,
            eventId: row.eventId,
            ingestedAt: new Date(),
            isolationKey,
            recomputeRunId: run.id,
            recordSnapshot: json(row.recordSnapshot),
            sourceVersion: row.sourceVersion,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          })),
        });
      const outputCount = facts.length + dimensions.length;
      const completed = await tx.controlLakeRecomputeRun.update({
        data: {
          completedAt: new Date(),
          outputCount,
          sourceSnapshot: json({
            dimensionSnapshotIds: dimensions.map(({ id }) => id),
            factSnapshotIds: facts.map(({ id }) => id),
            fromAt,
            toAt,
          }),
          status: 'COMPLETED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: run.id },
      });
      await this.record(
        tx,
        run.id,
        'ControlLakeRecomputeRun',
        completed.version,
        'control.lake-recomputed.v1',
        { dataset, isolationKey, outputCount },
        context,
        metadata,
      );
      return {
        isolationKey,
        outputCount,
        recomputeRunId: run.id,
        status: completed.status,
      };
    });
  }

  async workbench(context: TenantContext) {
    const where = { tenantId: context.tenantId };
    const [
      metrics,
      metricVersions,
      observations,
      dashboards,
      dashboardVersions,
      widgets,
      reports,
      reportVersions,
      jobs,
      watermarks,
      facts,
      dimensions,
      recomputes,
    ] = await Promise.all([
      this.prisma.controlMetricDefinition.findMany({
        orderBy: { code: 'asc' },
        take: 500,
        where,
      }),
      this.prisma.controlMetricDefinitionVersion.findMany({
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        take: 1000,
        where,
      }),
      this.prisma.controlMetricObservation.findMany({
        orderBy: [{ periodEnd: 'desc' }, { id: 'desc' }],
        take: 1000,
        where,
      }),
      this.prisma.controlDashboard.findMany({
        orderBy: { code: 'asc' },
        take: 500,
        where,
      }),
      this.prisma.controlDashboardVersion.findMany({
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        take: 500,
        where,
      }),
      this.prisma.controlDashboardWidgetConfig.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1000,
        where,
      }),
      this.prisma.controlReportDefinition.findMany({
        orderBy: { code: 'asc' },
        take: 500,
        where,
      }),
      this.prisma.controlReportDefinitionVersion.findMany({
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        take: 500,
        where,
      }),
      this.prisma.controlQueryJob.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
        where,
      }),
      this.prisma.controlLakeWatermark.findMany({
        orderBy: { dataset: 'asc' },
        take: 500,
        where,
      }),
      this.prisma.controlLakeFactSnapshot.findMany({
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 1000,
        where,
      }),
      this.prisma.controlLakeDimensionSnapshot.findMany({
        orderBy: [{ effectiveAt: 'desc' }, { id: 'desc' }],
        take: 1000,
        where,
      }),
      this.prisma.controlLakeRecomputeRun.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
        where,
      }),
    ]);
    return toHttpJson({
      dashboardVersions,
      dashboards,
      dimensionSnapshots: dimensions,
      factSnapshots: facts,
      jobs,
      metricVersions,
      metrics,
      observations,
      recomputes,
      refreshedAt: new Date(),
      reportVersions,
      reports,
      watermarks,
      widgets,
    });
  }

  private calculate(
    raw: Prisma.JsonValue,
    components: Readonly<Record<string, string>>,
  ) {
    const formula = object(raw);
    const operands = strings(formula.operands);
    const values = operands.map((operand) =>
      this.decimal(components[operand], operand),
    );
    const operator = String(formula.operator) as FormulaOperator;
    if (operator === 'COUNT') return new Prisma.Decimal(values.length);
    if (values.length === 0) this.invalid('Formula has no operands');
    if (operator === 'SUM')
      return values.reduce(
        (sum, value) => sum.plus(value),
        new Prisma.Decimal(0),
      );
    if (operator === 'AVERAGE')
      return values
        .reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0))
        .div(values.length);
    if (operator === 'RATIO') {
      if (values.length !== 2 || values[1]!.isZero())
        this.invalid('Ratio formula requires a nonzero denominator');
      return values[0]!.div(values[1]!);
    }
    this.invalid('Formula operator is invalid');
  }

  private assertMetric(input: PublishMetricInput) {
    this.code(input.code, 'metric code');
    this.text(input.name, 'name', 200);
    this.assertDimensions(input.dimensions, [...ALLOWED_DIMENSIONS]);
    if (new Set(input.dimensions).size !== input.dimensions.length)
      this.invalid('Metric dimensions contain duplicates');
    if (
      (input.formula.operator === 'RATIO' &&
        input.formula.operands.length !== 2) ||
      (input.formula.operator !== 'COUNT' &&
        input.formula.operands.length === 0) ||
      input.formula.operands.some(
        (operand) => !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(operand),
      )
    )
      this.invalid('Metric formula is invalid');
    if (
      input.dataSources.length === 0 ||
      input.dataSources.some((source) => !/^[A-Z][A-Z0-9_]{2,99}$/.test(source))
    )
      this.invalid('Metric data sources are invalid');
    if (
      !Number.isInteger(input.refreshPolicy.seconds) ||
      input.refreshPolicy.seconds < 5
    )
      this.invalid('Metric refresh policy is invalid');
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: input.timeZone }).format();
    } catch {
      this.invalid('Metric time zone is invalid');
    }
    const sensitive = input.sensitiveDimensions ?? [];
    if (sensitive.some((item) => !input.dimensions.includes(item)))
      this.invalid('Sensitive dimensions must be declared dimensions');
  }

  private assertDashboard(input: PublishDashboardInput) {
    this.code(input.code, 'dashboard code');
    this.text(input.name, 'name', 200);
    if (
      !Number.isInteger(input.refreshSeconds) ||
      input.refreshSeconds < 5 ||
      input.widgets.length === 0 ||
      new Set(input.widgets.map(({ key }) => key.trim().toUpperCase())).size !==
        input.widgets.length
    )
      this.invalid('Dashboard refresh or widget keys are invalid');
    for (const widget of input.widgets) {
      this.text(widget.key, 'widget key', 100);
      this.text(widget.title, 'widget title', 200);
    }
  }

  private assertReport(input: PublishReportInput) {
    this.code(input.code, 'report code');
    this.text(input.name, 'name', 200);
    if (input.metricCodes.length === 0)
      this.invalid('Report metrics are required');
    this.assertDimensions(input.dimensions, [...ALLOWED_DIMENSIONS]);
    for (const filter of input.filters ?? []) {
      if (!input.dimensions.includes(filter.field) || filter.operator !== 'EQ')
        this.invalid('Report filter is invalid');
    }
    if (
      (input.maskingFields ?? []).some(
        (field) => !input.dimensions.includes(field),
      )
    )
      this.invalid('Report masking fields are invalid');
    for (const value of [
      input.quota.dailyCost,
      input.quota.dailyExports,
      input.quota.dailyQueries,
      input.quota.maxRows,
      input.exportPolicy.maxRows,
    ])
      if (!Number.isInteger(value) || value < 1)
        this.invalid('Report quota is invalid');
  }

  private assertDimensions(
    input: readonly string[],
    allowed: readonly string[],
  ) {
    const accepted = new Set(allowed);
    if (input.some((item) => !accepted.has(item)))
      this.invalid('A dimension is not allowed by the semantic model');
  }

  private decimal(value: unknown, field: string) {
    try {
      const result = new Prisma.Decimal(String(value ?? ''));
      if (!result.isFinite()) throw new Error();
      return result;
    } catch {
      this.invalid(`${field} is invalid`);
    }
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

  private code(value: unknown, field: string) {
    const result = this.text(value, field, 100).toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{2,99}$/.test(result))
      this.invalid(`${field} is invalid`);
    return result;
  }

  private dataset(value: unknown) {
    return this.code(value, 'dataset');
  }

  private date(value: unknown, field: string) {
    const result = new Date(String(value));
    if (Number.isNaN(result.getTime())) this.invalid(`${field} is invalid`);
    return result;
  }

  private text(value: unknown, field: string, maximum: number) {
    const result = typeof value === 'string' ? value.trim() : '';
    if (!result || result.length > maximum) this.invalid(`${field} is invalid`);
    return result;
  }

  private optionalText(value: unknown, maximum: number) {
    const result = typeof value === 'string' ? value.trim() : '';
    return result && result.length <= maximum ? result : undefined;
  }

  private quota(code: string) {
    return new AppError(code, 'Analytics query quota was exceeded', 429);
  }

  private lock(tx: Prisma.TransactionClient, key: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }

  private invalid(message: string): never {
    throw new AppError('CONTROL_BI_INPUT_INVALID', message, 400);
  }
}
