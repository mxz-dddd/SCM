import { describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '@scm/shared';
import type { IdempotencyService } from './idempotency.service';
import type { PrismaService } from '../../database/prisma.service';
import {
  WorkflowService,
  assertApprovalTransition,
  validateWorkflowGraph,
  type WorkflowGraph,
} from './workflow.service';

const accountId = '10000000-0000-4000-8000-000000000001';
const tenantId = '10000000-0000-4000-8000-000000000002';
const context: TenantContext = {
  accountId,
  accountKind: 'TENANT_ADMIN',
  deviceId: 'test',
  organizationIds: [],
  permissionVersion: 1,
  tenantId,
  tokenId: 'token',
};
const metadata = {
  correlationId: 'correlation',
  idempotencyKey: 'workflow-key',
  ipAddress: '127.0.0.1',
};
const graph: WorkflowGraph = {
  nodes: [
    {
      candidates: { accountIds: [accountId] },
      key: 'review',
      name: 'Review',
      timeoutMinutes: 60,
      type: 'APPROVAL',
    },
    { key: 'done', name: 'Done', type: 'END' },
  ],
  startNodeKey: 'review',
  transitions: [{ from: 'review', to: 'done' }],
};

function idempotency(transaction: object) {
  const cache = new Map<string, { payload: string; result: object }>();
  return {
    execute: vi.fn(
      async (
        input: { key?: string; payload: unknown; scope: string },
        operation: (value: object) => Promise<object>,
      ) => {
        const key = `${input.scope}:${input.key}`;
        const payload = JSON.stringify(input.payload);
        const existing = cache.get(key);
        if (existing) {
          if (existing.payload !== payload)
            throw new Error('different content');
          return existing.result;
        }
        const result = await operation(transaction);
        cache.set(key, { payload, result });
        return result;
      },
    ),
  } as unknown as IdempotencyService;
}

describe('versioned workflow and approval contracts', () => {
  it('validates nodes, candidate selectors, timeout, routing and cycles', () => {
    expect(() => validateWorkflowGraph(graph)).not.toThrow();
    expect(() =>
      validateWorkflowGraph({
        ...graph,
        transitions: [
          { from: 'review', to: 'done' },
          { from: 'done', to: 'review' },
        ],
      }),
    ).toThrow(/End nodes cannot/);
    expect(() =>
      validateWorkflowGraph({
        ...graph,
        nodes: [
          { ...graph.nodes[0]!, candidates: { accountIds: [] } },
          graph.nodes[1]!,
        ],
      }),
    ).toThrow(/Candidate selector/);
  });

  it('allows approval actions only while an instance is pending', () => {
    for (const action of [
      'APPROVE',
      'REJECT',
      'RETURN',
      'ADD_SIGN',
      'TRANSFER',
      'WITHDRAW',
    ] as const) {
      expect(() => assertApprovalTransition('PENDING', action)).not.toThrow();
    }
    expect(() => assertApprovalTransition('APPROVED', 'APPROVE')).toThrow(
      /not allowed/,
    );
  });

  it('binds an instance to an immutable published version and replays start once', async () => {
    const transaction = {
      account: { findMany: vi.fn(async () => [{ id: accountId }]) },
      accountRole: { findMany: vi.fn(async () => []) },
      approvalTask: { createMany: vi.fn(async () => ({ count: 1 })) },
      platformAuditLog: { create: vi.fn() },
      platformOutbox: { create: vi.fn() },
      role: { findMany: vi.fn(async () => []) },
      workflowDefinition: {
        findFirst: vi.fn(async () => ({
          code: 'ORDER_APPROVAL',
          definition: graph,
          id: '10000000-0000-4000-8000-000000000010',
          versionNumber: 7,
        })),
      },
      workflowInstance: { create: vi.fn() },
    };
    const service = new WorkflowService(
      idempotency(transaction),
      {} as PrismaService,
    );
    const input = {
      businessDomain: 'OMS',
      businessRef: 'SO-1',
      definitionCode: 'ORDER_APPROVAL',
      objectId: '10000000-0000-4000-8000-000000000020',
      objectType: 'ORDER',
      variables: { amount: 1000 },
    };
    const first = await service.start(input, context, metadata);
    await expect(service.start(input, context, metadata)).resolves.toEqual(
      first,
    );
    expect(transaction.workflowInstance.create).toHaveBeenCalledTimes(1);
    expect(transaction.workflowInstance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          definitionSnapshot: graph,
          definitionVersionNumber: 7,
        }),
      }),
    );
  });

  it('denies an action from anyone other than the current assignee', async () => {
    const transaction = {
      approvalTask: {
        findFirst: vi.fn(async () => ({
          assigneeAccountId: accountId,
          id: '10000000-0000-4000-8000-000000000030',
          status: 'PENDING',
          version: 1,
          workflowInstanceId: '10000000-0000-4000-8000-000000000040',
        })),
      },
    };
    const service = new WorkflowService(
      idempotency(transaction),
      {} as PrismaService,
    );
    await expect(
      service.command(
        '10000000-0000-4000-8000-000000000030',
        { action: 'APPROVE', expectedVersion: 1 },
        { ...context, accountId: '10000000-0000-4000-8000-000000000099' },
        metadata,
      ),
    ).rejects.toMatchObject({
      code: 'APPROVAL_ASSIGNEE_DENIED',
      statusCode: 403,
    });
  });
});
