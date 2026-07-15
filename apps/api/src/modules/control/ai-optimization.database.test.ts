import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../common/app-error';
import { IdempotencyService } from '../platform/idempotency.service';
import { JobService } from '../platform/job.service';
import { JobSchedulingFacade } from '../platform/public/job-scheduling.facade';
import { AiOptimizationService } from './ai-optimization.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('Control AI optimization', () => {
  afterAll(() => prisma.$disconnect());

  it('persists explainable solver artifacts, governed forecasts, advisory inventory policy and isolated scenarios', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const organizationRef = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'USER',
      deviceId: 'control-ai-database-test',
      organizationIds: [organizationRef],
      permissionVersion: 1,
      tenantId,
      tokenId: randomUUID(),
    };
    const command = () => ({
      correlationId: randomUUID(),
      idempotencyKey: randomUUID(),
      ipAddress: '127.0.0.1',
    });
    const queue = {
      enqueue: vi.fn().mockResolvedValue(undefined),
      scheduleDefinition: vi.fn().mockResolvedValue(undefined),
    };
    const scheduling = new JobSchedulingFacade(
      new JobService(
        new IdempotencyService(prisma as never),
        queue as never,
        prisma as never,
      ),
    );
    const solveRoutes = vi.fn().mockResolvedValue({
      constraints: [
        { code: 'CAPACITY', detail: 'Constraint satisfied', satisfied: true },
        {
          code: 'TIME_WINDOWS',
          detail: 'Constraint satisfied',
          satisfied: true,
        },
      ],
      explanation: 'Assigned 2 mandatory stops to one vehicle.',
      objectiveValue: 35,
      requestId: 'route-result',
      routes: [
        {
          arrivalMinutes: [10, 25],
          distance: 30,
          durationMinutes: 45,
          load: 10,
          stopIds: ['STOP-A', 'STOP-B'],
          vehicleId: 'VEHICLE-1',
        },
      ],
      solver: 'OR_TOOLS_ROUTING',
      solverVersion: 'ortools-9.14.6206',
      status: 'FEASIBLE',
    });
    const solveLoad = vi.fn().mockResolvedValue({
      constraints: [
        { code: 'WEIGHT', detail: 'Constraint satisfied', satisfied: true },
        {
          code: 'UNLOADING_ORDER',
          detail: 'Constraint satisfied',
          satisfied: true,
        },
      ],
      explanation: 'Placed two pallets with unloading order preserved.',
      objectiveValue: 10,
      placements: [
        { bay: 0, containerId: 'TRUCK-1', itemId: 'PALLET-A' },
        { bay: 1, containerId: 'TRUCK-1', itemId: 'PALLET-B' },
      ],
      requestId: 'load-result',
      solver: 'OR_TOOLS_CP_SAT',
      solverVersion: 'ortools-9.14.6206',
      status: 'OPTIMAL',
    });
    const service = new AiOptimizationService(prisma as never, scheduling, {
      solveLoad,
      solveRoutes,
    } as never);

    const routeInput = {
      distanceMatrix: [
        [0, 10, 20],
        [10, 0, 10],
        [20, 10, 0],
      ],
      durationMatrix: [
        [0, 10, 20],
        [10, 0, 10],
        [20, 10, 0],
      ],
      locations: [{ id: 'DEPOT' }, { id: 'A' }, { id: 'B' }],
      objective: { mode: 'MIN_DISTANCE_AND_VEHICLES' },
      organizationRef,
      stops: [
        {
          demand: 4,
          id: 'STOP-A',
          locationIndex: 1,
          serviceMinutes: 5,
          windowEndMinutes: 100,
          windowStartMinutes: 0,
        },
        {
          demand: 6,
          id: 'STOP-B',
          locationIndex: 2,
          serviceMinutes: 5,
          windowEndMinutes: 100,
          windowStartMinutes: 0,
        },
      ],
      vehicles: [
        { capacity: 10, fixedCost: 5, id: 'VEHICLE-1', maxMinutes: 120 },
      ],
    };
    const queuedRoute = await service.createRouteOptimization(
      routeInput,
      context,
      command(),
    );
    expect(queuedRoute).toMatchObject({ accepted: true, status: 'QUEUED' });
    const routeJobId = String(queuedRoute.jobId);
    const completedRoute = await service.executeJob(
      {
        aggregateId: String(queuedRoute.aggregateId),
        jobRunId: routeJobId,
        kind: 'ROUTE',
      },
      context,
      command(),
    );
    expect(completedRoute).toMatchObject({ status: 'SUCCEEDED' });
    expect(
      await service.executeJob(
        {
          aggregateId: String(queuedRoute.aggregateId),
          jobRunId: routeJobId,
          kind: 'ROUTE',
        },
        context,
        command(),
      ),
    ).toMatchObject({ duplicate: true });
    const routeResult =
      await prisma.controlRouteOptimizationResult.findFirstOrThrow({
        where: { tenantId },
      });
    expect(routeResult).toMatchObject({
      feasibility: 'FEASIBLE',
      solverVersion: 'ortools-9.14.6206',
    });
    await expect(
      prisma.controlRouteOptimizationResult.update({
        data: { explanation: 'MUTATED' },
        where: { id: routeResult.id },
      }),
    ).rejects.toThrow();

    solveRoutes.mockRejectedValueOnce(
      new AppError('CONTROL_AI_OPTIMIZER_UNAVAILABLE', 'offline', 503, {
        retryable: true,
      }),
    );
    const retryRoute = await service.createRouteOptimization(
      routeInput,
      context,
      command(),
    );
    await expect(
      service.executeJob(
        {
          aggregateId: String(retryRoute.aggregateId),
          jobRunId: String(retryRoute.jobId),
          kind: 'ROUTE',
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'CONTROL_AI_OPTIMIZER_UNAVAILABLE' });
    expect(
      await prisma.controlRouteOptimization.findUniqueOrThrow({
        where: { id: String(retryRoute.aggregateId) },
      }),
    ).toMatchObject({ status: 'FAILED' });
    expect(
      await service.executeJob(
        {
          aggregateId: String(retryRoute.aggregateId),
          jobRunId: String(retryRoute.jobId),
          kind: 'ROUTE',
        },
        context,
        command(),
      ),
    ).toMatchObject({ status: 'SUCCEEDED' });

    const callsBeforeRace = solveRoutes.mock.calls.length;
    solveRoutes.mockImplementationOnce(
      async () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                constraints: [],
                explanation: 'Concurrent claim solved once.',
                objectiveValue: 10,
                routes: [],
                solver: 'OR_TOOLS_ROUTING',
                solverVersion: 'ortools-9.14.6206',
                status: 'FEASIBLE',
              }),
            30,
          ),
        ),
    );
    const concurrentRoute = await service.createRouteOptimization(
      routeInput,
      context,
      command(),
    );
    const concurrentResults = await Promise.all([
      service.executeJob(
        {
          aggregateId: String(concurrentRoute.aggregateId),
          jobRunId: String(concurrentRoute.jobId),
          kind: 'ROUTE',
        },
        context,
        command(),
      ),
      service.executeJob(
        {
          aggregateId: String(concurrentRoute.aggregateId),
          jobRunId: String(concurrentRoute.jobId),
          kind: 'ROUTE',
        },
        context,
        command(),
      ),
    ]);
    expect(solveRoutes.mock.calls).toHaveLength(callsBeforeRace + 1);
    expect(concurrentResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'SUCCEEDED' }),
        expect.objectContaining({ duplicate: true }),
      ]),
    );

    const loadInput = {
      containers: [
        {
          bayCount: 4,
          id: 'TRUCK-1',
          maxCgOffset: 300,
          maxVolume: 1000,
          maxWeight: 1000,
        },
      ],
      items: [
        {
          id: 'PALLET-A',
          incompatibleWith: [],
          unloadSequence: 1,
          volume: 100,
          weight: 200,
        },
        {
          id: 'PALLET-B',
          incompatibleWith: [],
          unloadSequence: 2,
          volume: 100,
          weight: 200,
        },
      ],
      organizationRef,
    };
    const queuedLoad = await service.createLoadOptimization(
      loadInput,
      context,
      command(),
    );
    await service.executeJob(
      {
        aggregateId: String(queuedLoad.aggregateId),
        jobRunId: String(queuedLoad.jobId),
        kind: 'LOAD',
      },
      context,
      command(),
    );
    let load = await prisma.controlLoadOptimizationResult.findUniqueOrThrow({
      where: { id: String(queuedLoad.aggregateId) },
    });
    expect(load.status).toBe('PROPOSED');
    await service.decideLoad(
      load.id,
      {
        decision: 'CONFIRMED',
        expectedVersion: load.version,
        reason: '人工复核通过',
      },
      context,
      command(),
    );
    load = await prisma.controlLoadOptimizationResult.findUniqueOrThrow({
      where: { id: load.id },
    });
    await service.recordLoadDeviation(
      load.id,
      {
        actual: { movedItems: [], note: '无偏差' },
        expectedVersion: load.version,
      },
      context,
      command(),
    );
    await expect(
      service.recordLoadDeviation(
        load.id,
        { actual: { note: '覆盖' }, expectedVersion: load.version + 1 },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'CONTROL_AI_STATE_CONFLICT' });
    const rejectedLoad = await service.createLoadOptimization(
      loadInput,
      context,
      command(),
    );
    await service.executeJob(
      {
        aggregateId: String(rejectedLoad.aggregateId),
        jobRunId: String(rejectedLoad.jobId),
        kind: 'LOAD',
      },
      context,
      command(),
    );
    const proposedForRejection =
      await prisma.controlLoadOptimizationResult.findUniqueOrThrow({
        where: { id: String(rejectedLoad.aggregateId) },
      });
    expect(
      await service.decideLoad(
        proposedForRejection.id,
        {
          decision: 'REJECTED',
          expectedVersion: proposedForRejection.version,
          reason: '现场车型不匹配',
        },
        context,
        command(),
      ),
    ).toMatchObject({ status: 'REJECTED' });

    const packageSpecVersionId = randomUUID();
    const productId = randomUUID();
    const trainingFrom = new Date('2031-01-01T00:00:00.000Z');
    const trainingTo = new Date('2031-01-07T00:00:00.000Z');
    const forecastInput = {
      confidenceLevel: 0.95,
      dimensions: { productId, region: 'EAST' },
      granularity: 'DAY' as const,
      history: Array.from({ length: 7 }, (_, index) => ({
        at: new Date(trainingFrom.getTime() + index * 86_400_000).toISOString(),
        baseQty: String(90 + index * 5),
        baseUom: 'EA',
        packageSpecVersionId,
        qty: String(9 + index / 2),
        uom: 'BOX',
      })),
      horizon: 14,
      organizationRef,
      trainingFrom: trainingFrom.toISOString(),
      trainingTo: trainingTo.toISOString(),
    };
    const forecastV1 = await service.createForecast(
      forecastInput,
      context,
      command(),
    );
    const publishedV1 = await service.publishForecast(
      String(forecastV1.id),
      { expectedVersion: Number(forecastV1.version) },
      context,
      command(),
    );
    expect(publishedV1).toMatchObject({
      status: 'PUBLISHED',
      versionNumber: 1,
    });
    const forecastV2 = await service.createForecast(
      forecastInput,
      context,
      command(),
    );
    const publishedV2 = await service.publishForecast(
      String(forecastV2.id),
      { expectedVersion: Number(forecastV2.version) },
      context,
      command(),
    );
    expect(publishedV2).toMatchObject({
      status: 'PUBLISHED',
      versionNumber: 2,
    });
    expect(
      await prisma.controlDemandForecast.findUniqueOrThrow({
        where: { id: String(forecastV1.id) },
      }),
    ).toMatchObject({ status: 'RETIRED' });
    const feedbackForecast = await service.recordForecastDeviation(
      String(forecastV2.id),
      {
        actualPoints: [
          { at: '2031-01-08T00:00:00.000Z', baseQty: '111.000000' },
        ],
        expectedVersion: Number(publishedV2.version),
      },
      context,
      command(),
    );
    expect(feedbackForecast.actualDeviationSnapshot).toEqual(expect.any(Array));

    const beforeInventory = await prisma.inventoryBalance.count({
      where: { tenantId },
    });
    const recommendationInput = {
      currentInventory: {
        baseQty: '250',
        baseUom: 'EA',
        packageSpecVersionId,
        qty: '25',
        shelfLifeDays: 120,
        uom: 'BOX',
      },
      forecastId: String(forecastV2.id),
      leadTimeDays: 3,
      organizationRef,
      productId,
      serviceLevel: 0.95,
      warehouseId: randomUUID(),
    };
    const acceptedRecommendation = await service.createInventoryRecommendation(
      recommendationInput,
      context,
      command(),
    );
    expect(
      await service.decideRecommendation(
        String(acceptedRecommendation.id),
        {
          decision: 'ACCEPTED',
          expectedVersion: Number(acceptedRecommendation.version),
          reason: '计划员采纳，后续另走 WMS 命令',
        },
        context,
        command(),
      ),
    ).toMatchObject({ status: 'ACCEPTED' });
    const rejectedRecommendation = await service.createInventoryRecommendation(
      recommendationInput,
      context,
      command(),
    );
    expect(
      await service.decideRecommendation(
        String(rejectedRecommendation.id),
        {
          decision: 'REJECTED',
          expectedVersion: Number(rejectedRecommendation.version),
          reason: '现有在途足够',
        },
        context,
        command(),
      ),
    ).toMatchObject({ status: 'REJECTED' });
    const expiredRecommendation = await service.createInventoryRecommendation(
      recommendationInput,
      context,
      command(),
    );
    expect(
      await service.decideRecommendation(
        String(expiredRecommendation.id),
        {
          decision: 'EXPIRED',
          expectedVersion: Number(expiredRecommendation.version),
          reason: '预测窗口已过',
        },
        context,
        command(),
      ),
    ).toMatchObject({ status: 'EXPIRED' });
    expect(await prisma.inventoryBalance.count({ where: { tenantId } })).toBe(
      beforeInventory,
    );

    const scenarioInput = {
      baselineSnapshot: {
        carrierCapacityBaseQty: '1000',
        demandBaseQty: '900',
        variableCost: { amount: '2.50', currency: 'CNY' },
        warehouses: [
          {
            capacityBaseQty: '1000',
            fixedCost: { amount: '5000', currency: 'CNY' },
            id: randomUUID(),
            open: true,
            slaMinutes: 480,
          },
        ],
      },
      changes: { demandMultiplier: 1.1, slaTargetMinutes: 420 },
      name: '基础增长情景',
      organizationRef,
      scenarioNo: `SCENARIO-${randomUUID()}`,
    };
    const scenario = await service.createScenario(
      scenarioInput,
      context,
      command(),
    );
    const queuedScenario = await service.runScenario(
      String(scenario.id),
      { expectedVersion: Number(scenario.version) },
      context,
      command(),
    );
    expect(
      await service.executeJob(
        {
          aggregateId: String(queuedScenario.aggregateId),
          jobRunId: String(queuedScenario.jobId),
          kind: 'NETWORK',
        },
        context,
        command(),
      ),
    ).toMatchObject({ status: 'COMPLETED' });
    const exportResult = await service.exportScenario(
      String(scenario.id),
      context,
    );
    expect(exportResult).toMatchObject({
      export: { comparison: { baselineAvailable: false } },
    });

    const comparisonScenario = await service.createScenario(
      {
        ...scenarioInput,
        baselineScenarioId: String(scenario.id),
        changes: { demandMultiplier: 1.3 },
        name: '比较情景',
        scenarioNo: `SCENARIO-${randomUUID()}`,
      },
      context,
      command(),
    );
    const queuedComparison = await service.runScenario(
      String(comparisonScenario.id),
      { expectedVersion: Number(comparisonScenario.version) },
      context,
      command(),
    );
    await service.executeJob(
      {
        aggregateId: String(queuedComparison.aggregateId),
        jobRunId: String(queuedComparison.jobId),
        kind: 'NETWORK',
      },
      context,
      command(),
    );
    const completedComparison =
      await prisma.controlNetworkScenario.findUniqueOrThrow({
        where: { id: String(comparisonScenario.id) },
      });
    expect(
      await service.archiveScenario(
        completedComparison.id,
        { expectedVersion: completedComparison.version },
        context,
        command(),
      ),
    ).toMatchObject({ status: 'ARCHIVED' });
    const comparisonResult =
      await prisma.controlSimulationResult.findFirstOrThrow({
        where: { scenarioId: String(comparisonScenario.id) },
      });
    expect(comparisonResult.comparisonSnapshot).toMatchObject({
      baselineAvailable: true,
    });
    await expect(
      prisma.controlSimulationResult.delete({
        where: { id: comparisonResult.id },
      }),
    ).rejects.toThrow();

    await expect(
      service.createRouteOptimization(
        { ...routeInput, organizationRef: randomUUID() },
        context,
        command(),
      ),
    ).rejects.toMatchObject({
      code: 'CONTROL_AI_SCOPE_DENIED',
      statusCode: 403,
    });
    const isolated = await service.workbench({
      ...context,
      accountId: randomUUID(),
      organizationIds: [],
      tenantId: randomUUID(),
    });
    expect(isolated).toMatchObject({
      forecasts: [],
      loads: [],
      recommendations: [],
      routeResults: [],
      routes: [],
      scenarios: [],
      simulationResults: [],
    });
    expect(
      await prisma.platformOutbox.count({
        where: { eventName: { startsWith: 'control.' }, tenantId },
      }),
    ).toBeGreaterThan(20);
    expect(
      await prisma.jobDefinition.count({
        where: { code: 'CONTROL.AI.OPTIMIZATION', tenantId },
      }),
    ).toBe(1);
    expect(queue.scheduleDefinition).toHaveBeenCalledTimes(1);
    expect(queue.enqueue).toHaveBeenCalledTimes(7);
  });
});
