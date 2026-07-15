import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import type { BusinessEventInput } from '../platform/event.service';
import { EventService } from '../platform/event.service';
import { IdempotencyService } from '../platform/idempotency.service';
import { EventConsumptionFacade } from '../platform/public/event-consumption.facade';
import { BiAnalyticsService } from './bi-analytics.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('Control BI analytics and lake snapshots', () => {
  afterAll(() => prisma.$disconnect());

  it('pins published semantics and governs dashboards, queries and isolated lake recomputes', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'control-bi-database-test',
      organizationIds: [],
      permissionVersion: 1,
      tenantId,
      tokenId: randomUUID(),
    };
    const command = () => ({
      correlationId: randomUUID(),
      idempotencyKey: randomUUID(),
      ipAddress: '127.0.0.1',
    });
    const service = new BiAnalyticsService(
      prisma as never,
      new EventConsumptionFacade(
        new EventService(
          new IdempotencyService(prisma as never),
          prisma as never,
        ),
      ),
    );

    const metricV1 = await service.publishMetric(
      {
        code: 'ON_TIME_RATE',
        dataSources: ['SHIPMENT_FACT'],
        dimensions: ['organizationRef', 'warehouseRef', 'customerRef', 'date'],
        formula: { operands: ['onTime', 'total'], operator: 'RATIO' },
        granularity: 'DAY',
        name: '运输准时率',
        refreshPolicy: { mode: 'EVENT', seconds: 30 },
        sensitiveDimensions: ['customerRef'],
        timeZone: 'Asia/Shanghai',
      },
      context,
      command(),
    );
    const dimensions = {
      customerRef: 'CUSTOMER-P4-08',
      date: '2030-07-10',
      organizationRef: 'ORG-EAST',
      warehouseRef: 'WH-SHA',
    };
    const observationV1 = await service.observeMetric(
      'ON_TIME_RATE',
      {
        components: { onTime: '90', total: '100' },
        dimensions,
        periodEnd: '2030-07-11T00:00:00.000Z',
        periodStart: '2030-07-10T00:00:00.000Z',
        source: { eventVersion: 7 },
      },
      context,
      command(),
    );
    expect(observationV1).toMatchObject({ duplicate: false, value: '0.9' });
    expect(
      await service.observeMetric(
        'ON_TIME_RATE',
        {
          components: { onTime: '90', total: '100' },
          dimensions,
          periodEnd: '2030-07-11T00:00:00.000Z',
          periodStart: '2030-07-10T00:00:00.000Z',
        },
        context,
        command(),
      ),
    ).toMatchObject({ duplicate: true, value: '0.9' });
    await expect(
      service.observeMetric(
        'ON_TIME_RATE',
        {
          components: { onTime: '89', total: '100' },
          dimensions,
          periodEnd: '2030-07-11T00:00:00.000Z',
          periodStart: '2030-07-10T00:00:00.000Z',
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({
      code: 'CONTROL_METRIC_OBSERVATION_CONFLICT',
      statusCode: 409,
    });

    const report = await service.publishReport(
      {
        code: 'DAILY_SERVICE',
        dimensions: ['organizationRef', 'warehouseRef', 'customerRef', 'date'],
        exportPolicy: { allowed: true, maxRows: 100 },
        maskingFields: ['customerRef'],
        metricCodes: ['ON_TIME_RATE'],
        name: '每日服务分析',
        quota: {
          dailyCost: 100000,
          dailyExports: 1,
          dailyQueries: 3,
          maxRows: 100,
        },
        semanticModel: 'CONTROL_METRICS',
        visibility: 'PRIVATE',
      },
      context,
      command(),
    );

    const metricV2 = await service.publishMetric(
      {
        code: 'ON_TIME_RATE',
        dataSources: ['SHIPMENT_FACT'],
        dimensions: ['organizationRef', 'warehouseRef', 'customerRef', 'date'],
        formula: { operands: ['onTime', 'total'], operator: 'RATIO' },
        granularity: 'DAY',
        name: '运输准时率（新口径）',
        refreshPolicy: { mode: 'SCHEDULED', seconds: 60 },
        sensitiveDimensions: ['customerRef'],
        timeZone: 'Asia/Shanghai',
      },
      context,
      command(),
    );
    expect(metricV2).toMatchObject({ versionNumber: 2 });
    await service.observeMetric(
      'ON_TIME_RATE',
      {
        components: { onTime: '95', total: '100' },
        dimensions: { ...dimensions, date: '2030-07-11' },
        periodEnd: '2030-07-12T00:00:00.000Z',
        periodStart: '2030-07-11T00:00:00.000Z',
      },
      context,
      command(),
    );
    const storedV1 = await prisma.controlMetricObservation.findUniqueOrThrow({
      where: { id: observationV1.metricObservationId },
    });
    expect(storedV1).toMatchObject({
      metricVersionId: metricV1.metricVersionId,
    });
    expect(storedV1.value.toString()).toBe('0.9');
    await expect(
      prisma.controlMetricDefinitionVersion.update({
        data: { timeZone: 'UTC' },
        where: { id: metricV1.metricVersionId },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.controlMetricObservation.update({
        data: { value: '0.1' },
        where: { id: observationV1.metricObservationId },
      }),
    ).rejects.toThrow();

    const dashboard = await service.publishDashboard(
      {
        code: 'OPS_NETWORK',
        layout: { columns: 12 },
        name: '运营网络看板',
        organizationRef: 'ORG-EAST',
        refreshSeconds: 30,
        warehouseRef: 'WH-SHA',
        widgets: [
          {
            key: 'rate-card',
            metricCode: 'ON_TIME_RATE',
            position: { h: 2, w: 2, x: 0, y: 0 },
            title: '准时率',
            type: 'CARD',
          },
          {
            key: 'rate-trend',
            metricCode: 'ON_TIME_RATE',
            position: { h: 2, w: 4, x: 2, y: 0 },
            title: '趋势',
            type: 'TREND',
          },
          {
            key: 'network-map',
            position: { h: 4, w: 6, x: 6, y: 0 },
            title: '网络地图',
            type: 'MAP',
          },
          {
            key: 'ranking',
            metricCode: 'ON_TIME_RATE',
            position: { h: 3, w: 3, x: 0, y: 2 },
            title: '排行',
            type: 'RANKING',
          },
          {
            key: 'funnel',
            position: { h: 3, w: 3, x: 3, y: 2 },
            title: '履约漏斗',
            type: 'FUNNEL',
          },
          {
            key: 'alert',
            position: { h: 3, w: 3, x: 6, y: 4 },
            title: '预警',
            type: 'ALERT',
          },
          {
            key: 'ticker',
            metricCode: 'ON_TIME_RATE',
            position: { h: 1, w: 3, x: 9, y: 4 },
            title: '实时播报',
            type: 'TICKER',
          },
        ],
      },
      context,
      command(),
    );
    expect(dashboard).toMatchObject({ status: 'PUBLISHED', versionNumber: 1 });
    const dashboardView = await service.dashboard(
      'OPS_NETWORK',
      { organizationRef: 'ORG-EAST', warehouseRef: 'WH-SHA' },
      context,
    );
    expect(dashboardView).toMatchObject({
      refreshSeconds: 30,
      versionNumber: 1,
    });
    expect(dashboardView.widgets).toHaveLength(7);
    expect(new Date(dashboardView.nextRefreshAt).getTime()).toBeGreaterThan(
      Date.now(),
    );
    await expect(
      service.dashboard(
        'OPS_NETWORK',
        { organizationRef: 'ORG-WEST', warehouseRef: 'WH-SHA' },
        context,
      ),
    ).rejects.toMatchObject({
      code: 'CONTROL_DASHBOARD_CONTEXT_DENIED',
      statusCode: 403,
    });

    const masked = await service.runQuery(
      report.reportId,
      { filters: { organizationRef: 'ORG-EAST' }, rowLimit: 10 },
      context,
      { exportRequested: false, sensitiveAccess: false },
    );
    expect(masked).toMatchObject({
      maskedFields: ['customerRef'],
      reportVersion: 1,
      rowCount: 1,
      status: 'COMPLETED',
    });
    expect(masked.rows[0]).toMatchObject({
      dimensions: { customerRef: '***' },
      metricCode: 'ON_TIME_RATE',
      metricVersion: 1,
      value: '0.9',
    });
    const sensitive = await service.runQuery(
      report.reportId,
      { rowLimit: 10 },
      context,
      { exportRequested: false, sensitiveAccess: true },
    );
    expect(sensitive.rows[0]).toMatchObject({
      dimensions: { customerRef: 'CUSTOMER-P4-08' },
    });
    const exported = await service.runQuery(
      report.reportId,
      { rowLimit: 10 },
      context,
      { exportRequested: true, sensitiveAccess: false },
    );
    expect(exported.status).toBe('COMPLETED');
    await expect(
      service.runQuery(report.reportId, { rowLimit: 10 }, context, {
        exportRequested: true,
        sensitiveAccess: false,
      }),
    ).rejects.toMatchObject({
      code: 'CONTROL_QUERY_DAILY_QUOTA_EXCEEDED',
      statusCode: 429,
    });
    await expect(
      service.runQuery(
        report.reportId,
        { rowLimit: 10 },
        { ...context, accountId: randomUUID() },
        { exportRequested: false, sensitiveAccess: false },
      ),
    ).rejects.toMatchObject({
      code: 'CONTROL_REPORT_ACCESS_DENIED',
      statusCode: 403,
    });
    await expect(
      prisma.controlQueryJob.update({
        data: { rowCount: 99 },
        where: { id: masked.jobId },
      }),
    ).rejects.toThrow();

    const lakeEvent = (
      aggregateId: string,
      aggregateVersion: number,
      occurredAt: string,
      lake: Record<string, unknown>,
    ): BusinessEventInput => ({
      aggregateId,
      aggregateType: 'Shipment',
      aggregateVersion,
      eventId: randomUUID(),
      eventType: 'tms.shipment-delivered.v1',
      occurredAt,
      payload: { businessRef: `SHIP-${aggregateId.slice(0, 8)}`, lake },
      schemaVersion: 1,
      traceId: 'control-bi-lake-p4-08',
    });
    const aggregateId = randomUUID();
    const online = lakeEvent(aggregateId, 2, '2030-07-10T10:00:00.000Z', {
      businessRef: 'SHIP-P4-08-001',
      dataset: 'SHIPMENT_FACT',
      record: { delivered: true, warehouseRef: 'WH-SHA' },
      recordType: 'FACT',
    });
    expect(
      await service.consumeLakeEvent(online, context, command()),
    ).toMatchObject({ duplicate: false, status: 'PROCESSED' });
    expect(
      await service.consumeLakeEvent(online, context, command()),
    ).toMatchObject({
      duplicate: true,
      status: 'PROCESSED',
    });
    await expect(
      service.consumeLakeEvent(
        { ...online, payload: { ...online.payload, conflict: true } },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'EVENT_REPLAY_CONFLICT', statusCode: 409 });
    expect(
      await service.consumeLakeEvent(
        { ...online, aggregateVersion: 1, eventId: randomUUID() },
        context,
        command(),
      ),
    ).toMatchObject({ status: 'PROCESSED' });
    const late = lakeEvent(randomUUID(), 1, '2030-07-08T10:00:00.000Z', {
      businessRef: 'SHIP-P4-08-LATE',
      dataset: 'SHIPMENT_FACT',
      record: { delivered: false, warehouseRef: 'WH-SHA' },
      recordType: 'FACT',
    });
    expect(
      await service.consumeLakeEvent(late, context, command()),
    ).toMatchObject({ status: 'PROCESSED' });
    const dimension = lakeEvent(randomUUID(), 3, '2030-07-09T10:00:00.000Z', {
      dataset: 'CUSTOMER_DIM',
      dimensionKey: 'CUSTOMER-P4-08',
      record: { name: '华东客户', regionRef: 'EAST' },
      recordType: 'DIMENSION',
    });
    expect(
      await service.consumeLakeEvent(dimension, context, command()),
    ).toMatchObject({ status: 'PROCESSED' });
    const watermark = await prisma.controlLakeWatermark.findUniqueOrThrow({
      where: { tenantId_dataset: { dataset: 'SHIPMENT_FACT', tenantId } },
    });
    expect(watermark.lateRecordCount).toBe(1);
    const onlineArrivalStatuses = await prisma.controlLakeFactSnapshot.findMany(
      {
        orderBy: { occurredAt: 'desc' },
        select: { arrivalStatus: true },
        where: { dataset: 'SHIPMENT_FACT', isolationKey: 'ONLINE', tenantId },
      },
    );
    expect(
      onlineArrivalStatuses.map(({ arrivalStatus }) => arrivalStatus).sort(),
    ).toEqual(['LATE', 'ON_TIME', 'ON_TIME']);
    expect(
      await prisma.controlLakeDimensionSnapshot.count({
        where: { dataset: 'CUSTOMER_DIM', isolationKey: 'ONLINE', tenantId },
      }),
    ).toBe(1);

    const recompute = await service.recomputeLake(
      {
        dataset: 'SHIPMENT_FACT',
        fromAt: '2030-07-01T00:00:00.000Z',
        toAt: '2030-08-01T00:00:00.000Z',
      },
      context,
      command(),
    );
    expect(recompute).toMatchObject({ outputCount: 3, status: 'COMPLETED' });
    expect(
      await prisma.controlLakeFactSnapshot.count({
        where: { dataset: 'SHIPMENT_FACT', isolationKey: 'ONLINE', tenantId },
      }),
    ).toBe(3);
    expect(
      await prisma.controlLakeFactSnapshot.count({
        where: { isolationKey: recompute.isolationKey, tenantId },
      }),
    ).toBe(3);
    const fact = await prisma.controlLakeFactSnapshot.findFirstOrThrow({
      where: { isolationKey: 'ONLINE', tenantId },
    });
    await expect(
      prisma.controlLakeFactSnapshot.update({
        data: { businessRef: 'MUTATED' },
        where: { id: fact.id },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.controlLakeFactSnapshot.delete({ where: { id: fact.id } }),
    ).rejects.toThrow();

    const workbench = await service.workbench(context);
    expect(workbench).toMatchObject({
      dashboards: [expect.objectContaining({ code: 'OPS_NETWORK' })],
      metrics: [expect.objectContaining({ code: 'ON_TIME_RATE' })],
      recomputes: [expect.objectContaining({ status: 'COMPLETED' })],
      reports: [expect.objectContaining({ code: 'DAILY_SERVICE' })],
    });
    const isolated = await service.workbench({
      ...context,
      accountId: randomUUID(),
      tenantId: randomUUID(),
    });
    expect(isolated.metrics).toEqual([]);
    expect(isolated.factSnapshots).toEqual([]);
    expect(isolated.jobs).toEqual([]);
  });
});
