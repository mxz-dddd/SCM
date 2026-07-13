import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type ApprovalActionType,
  type WorkflowInstanceStatus,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { IdempotencyService } from './idempotency.service';
import type { CommandMetadata } from './tenant.service';

type JsonObject = Readonly<Record<string, unknown>>;
type ConditionOperator = 'EQ' | 'GTE' | 'GT' | 'IN' | 'LTE' | 'LT' | 'NE';

export interface WorkflowCondition {
  readonly field: string;
  readonly operator: ConditionOperator;
  readonly value: unknown;
}

export interface CandidateSelector {
  readonly accountIds?: readonly string[];
  readonly conditions?: readonly WorkflowCondition[];
  readonly organizationIds?: readonly string[];
  readonly roleCodes?: readonly string[];
}

export interface WorkflowNode {
  readonly candidates?: CandidateSelector;
  readonly key: string;
  readonly name: string;
  readonly returnTo?: string;
  readonly timeoutMinutes?: number;
  readonly type: 'APPROVAL' | 'END';
}

export interface WorkflowTransition {
  readonly condition?: WorkflowCondition;
  readonly from: string;
  readonly to: string;
}

export interface WorkflowGraph {
  readonly nodes: readonly WorkflowNode[];
  readonly startNodeKey: string;
  readonly transitions: readonly WorkflowTransition[];
}

export interface SaveWorkflowDefinitionInput {
  readonly code: string;
  readonly definition: WorkflowGraph;
  readonly definitionId?: string;
  readonly description?: string;
  readonly expectedVersion?: number;
  readonly name: string;
}

export interface VersionInput {
  readonly expectedVersion: number;
}

export interface StartWorkflowInput {
  readonly businessDomain: string;
  readonly businessRef: string;
  readonly definitionCode: string;
  readonly objectId: string;
  readonly objectType: string;
  readonly organizationId?: string;
  readonly variables?: JsonObject;
}

export interface ApprovalCommandInput extends VersionInput {
  readonly action: ApprovalActionType;
  readonly comment?: string;
  readonly targetAccountId?: string;
}

export interface BatchApprovalInput {
  readonly action: 'APPROVE' | 'REJECT' | 'RETURN';
  readonly comment?: string;
  readonly tasks: readonly {
    readonly approvalTaskId: string;
    readonly expectedVersion: number;
  }[];
}

const CODE_PATTERN = /^[A-Z][A-Z0-9_.-]{2,99}$/;
const NODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/;
const TERMINAL_INSTANCE_STATUSES: readonly WorkflowInstanceStatus[] = [
  'APPROVED',
  'CANCELLED',
  'REJECTED',
  'RETURNED',
];

function compareCondition(
  condition: WorkflowCondition,
  variables: JsonObject,
): boolean {
  const actual = condition.field
    .split('.')
    .reduce<unknown>(
      (value, segment) =>
        value && typeof value === 'object'
          ? (value as Record<string, unknown>)[segment]
          : undefined,
      variables,
    );
  const expected = condition.value;
  if (condition.operator === 'EQ') return actual === expected;
  if (condition.operator === 'NE') return actual !== expected;
  if (condition.operator === 'IN') {
    return Array.isArray(expected) && expected.includes(actual);
  }
  if (typeof actual !== 'number' || typeof expected !== 'number') return false;
  if (condition.operator === 'GT') return actual > expected;
  if (condition.operator === 'GTE') return actual >= expected;
  if (condition.operator === 'LT') return actual < expected;
  return actual <= expected;
}

export function validateWorkflowGraph(definition: WorkflowGraph): void {
  if (
    !definition ||
    !Array.isArray(definition.nodes) ||
    !Array.isArray(definition.transitions) ||
    definition.nodes.length < 2 ||
    definition.nodes.length > 100
  ) {
    throw new AppError(
      'WORKFLOW_DEFINITION_INVALID',
      'Workflow graph is invalid',
      400,
    );
  }
  const keys = new Set(definition.nodes.map(({ key }) => key));
  if (
    keys.size !== definition.nodes.length ||
    !keys.has(definition.startNodeKey) ||
    definition.nodes.some(
      (node) =>
        !NODE_PATTERN.test(node.key) ||
        !node.name?.trim() ||
        !['APPROVAL', 'END'].includes(node.type) ||
        (node.type === 'APPROVAL' && !node.candidates) ||
        (node.timeoutMinutes !== undefined &&
          (!Number.isInteger(node.timeoutMinutes) ||
            node.timeoutMinutes < 1 ||
            node.timeoutMinutes > 525_600)) ||
        (node.returnTo !== undefined && !keys.has(node.returnTo)),
    ) ||
    definition.nodes.filter(({ type }) => type === 'END').length === 0 ||
    definition.transitions.some(
      (transition) =>
        !keys.has(transition.from) ||
        !keys.has(transition.to) ||
        transition.from === transition.to ||
        (transition.condition &&
          (!NODE_PATTERN.test(transition.condition.field) ||
            !['EQ', 'NE', 'IN', 'GT', 'GTE', 'LT', 'LTE'].includes(
              transition.condition.operator,
            ))),
    )
  ) {
    throw new AppError(
      'WORKFLOW_DEFINITION_INVALID',
      'Workflow nodes or transitions are invalid',
      400,
    );
  }
  for (const node of definition.nodes) {
    if (
      node.type === 'END' &&
      definition.transitions.some(({ from }) => from === node.key)
    ) {
      throw new AppError(
        'WORKFLOW_DEFINITION_INVALID',
        'End nodes cannot have outgoing transitions',
        400,
      );
    }
    if (
      node.type === 'APPROVAL' &&
      !definition.transitions.some(({ from }) => from === node.key)
    ) {
      throw new AppError(
        'WORKFLOW_DEFINITION_INVALID',
        'Every approval node needs a transition',
        400,
      );
    }
    const candidates = node.candidates;
    if (!candidates) continue;
    const accountIds: readonly string[] = candidates.accountIds ?? [];
    const organizationIds: readonly string[] = candidates.organizationIds ?? [];
    const roleCodes: readonly string[] = candidates.roleCodes ?? [];
    const conditions: readonly WorkflowCondition[] =
      candidates.conditions ?? [];
    if (
      accountIds.some((id) => !isUuid(id)) ||
      organizationIds.some((id) => !isUuid(id)) ||
      roleCodes.some((code) => !CODE_PATTERN.test(code)) ||
      accountIds.length + organizationIds.length + roleCodes.length === 0 ||
      conditions.some(
        (condition) =>
          !NODE_PATTERN.test(condition.field) ||
          !['EQ', 'NE', 'IN', 'GT', 'GTE', 'LT', 'LTE'].includes(
            condition.operator,
          ),
      )
    ) {
      throw new AppError(
        'WORKFLOW_CANDIDATE_INVALID',
        'Candidate selector is invalid',
        400,
      );
    }
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (key: string) => {
    if (visiting.has(key)) {
      throw new AppError(
        'WORKFLOW_DEFINITION_CYCLE',
        'Forward workflow transitions cannot cycle',
        400,
      );
    }
    if (visited.has(key)) return;
    visiting.add(key);
    for (const transition of definition.transitions.filter(
      ({ from }) => from === key,
    )) {
      visit(transition.to);
    }
    visiting.delete(key);
    visited.add(key);
  };
  visit(definition.startNodeKey);
  if (
    !definition.nodes
      .filter(({ type }) => type === 'END')
      .some(({ key }) => visited.has(key))
  ) {
    throw new AppError(
      'WORKFLOW_END_UNREACHABLE',
      'Workflow end node is unreachable',
      400,
    );
  }
}

export function assertApprovalTransition(
  current: WorkflowInstanceStatus,
  action: ApprovalActionType,
): void {
  const allowed =
    current === 'PENDING' &&
    [
      'APPROVE',
      'REJECT',
      'RETURN',
      'ADD_SIGN',
      'TRANSFER',
      'WITHDRAW',
    ].includes(action);
  if (!allowed || TERMINAL_INSTANCE_STATUSES.includes(current)) {
    throw new AppError(
      'APPROVAL_TRANSITION_INVALID',
      `Approval action ${action} is not allowed from ${current}`,
      409,
    );
  }
}

@Injectable()
export class WorkflowService {
  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  listDefinitions(context: TenantContext) {
    return this.prisma.workflowDefinition.findMany({
      orderBy: [{ code: 'asc' }, { versionNumber: 'desc' }],
      take: 200,
      where: { tenantId: context.tenantId },
    });
  }

  listTasks(context: TenantContext, status?: string) {
    if (
      status &&
      ![
        'PENDING',
        'APPROVED',
        'REJECTED',
        'RETURNED',
        'CANCELLED',
        'TRANSFERRED',
      ].includes(status)
    ) {
      throw new AppError(
        'APPROVAL_TASK_STATUS_INVALID',
        'Task status is invalid',
        400,
      );
    }
    return this.prisma.approvalTask.findMany({
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
      where: {
        ...(context.accountKind === 'USER'
          ? { assigneeAccountId: context.accountId }
          : {}),
        ...(status ? { status: status as never } : {}),
        tenantId: context.tenantId,
      },
    });
  }

  async getInstance(workflowInstanceId: string, context: TenantContext) {
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { id: workflowInstanceId, tenantId: context.tenantId },
    });
    if (!instance)
      throw new AppError(
        'WORKFLOW_INSTANCE_NOT_FOUND',
        'Workflow instance was not found',
        404,
      );
    const tasks = await this.prisma.approvalTask.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      where: { tenantId: context.tenantId, workflowInstanceId },
    });
    const visible =
      context.accountKind !== 'USER' ||
      instance.requesterId === context.accountId ||
      tasks.some(
        ({ assigneeAccountId }) => assigneeAccountId === context.accountId,
      );
    if (!visible)
      throw new AppError(
        'WORKFLOW_SCOPE_DENIED',
        'Workflow instance is outside data scope',
        403,
      );
    const actions = await this.prisma.approvalAction.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      where: { tenantId: context.tenantId, workflowInstanceId },
    });
    return { actions, instance, tasks };
  }

  saveDefinition(
    input: SaveWorkflowDefinitionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const code = input.code?.trim().toUpperCase();
    if (
      !CODE_PATTERN.test(code) ||
      !input.name?.trim() ||
      input.name.length > 200 ||
      (input.definitionId !== undefined && !isUuid(input.definitionId))
    ) {
      throw new AppError(
        'WORKFLOW_DEFINITION_INVALID',
        'Workflow definition input is invalid',
        400,
      );
    }
    validateWorkflowGraph(input.definition);
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: input.definitionId ? 200 : 201,
        scope: 'platform.workflow-definition.save.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const existing = input.definitionId
          ? await transaction.workflowDefinition.findFirst({
              where: {
                id: input.definitionId,
                status: 'DRAFT',
                tenantId: context.tenantId,
              },
            })
          : null;
        if (input.definitionId && !existing) {
          throw new AppError(
            'WORKFLOW_DRAFT_NOT_FOUND',
            'Editable workflow draft was not found',
            404,
          );
        }
        if (
          existing &&
          (input.expectedVersion === undefined ||
            existing.version !== input.expectedVersion)
        ) {
          throw this.versionConflict();
        }
        if (existing && existing.code !== code) {
          throw new AppError(
            'WORKFLOW_CODE_IMMUTABLE',
            'Workflow code cannot change within a version',
            409,
          );
        }
        const latest = existing
          ? null
          : await transaction.workflowDefinition.findFirst({
              orderBy: { versionNumber: 'desc' },
              where: { code, tenantId: context.tenantId },
            });
        const definition = existing
          ? await transaction.workflowDefinition.update({
              data: {
                definition:
                  input.definition as unknown as Prisma.InputJsonObject,
                description: input.description?.trim() || null,
                name: input.name.trim(),
                updatedBy: context.accountId,
                version: { increment: 1 },
              },
              where: { id: existing.id },
            })
          : await transaction.workflowDefinition.create({
              data: {
                code,
                createdBy: context.accountId,
                definition:
                  input.definition as unknown as Prisma.InputJsonObject,
                description: input.description?.trim() || null,
                id: randomUUID(),
                name: input.name.trim(),
                supersedesVersionId: latest?.id ?? null,
                tenantId: context.tenantId,
                updatedBy: context.accountId,
                versionNumber: (latest?.versionNumber ?? 0) + 1,
              },
            });
        await this.record(
          transaction,
          definition.id,
          definition.version,
          existing
            ? 'workflow.definition.updated'
            : 'workflow.definition.created',
          'platform.workflow-definition-saved.v1',
          context,
          metadata,
          {
            code,
            status: definition.status,
            versionNumber: definition.versionNumber,
          },
        );
        return {
          definitionId: definition.id,
          status: definition.status,
          version: definition.version,
          versionNumber: definition.versionNumber,
        };
      },
    );
  }

  publishDefinition(
    definitionId: string,
    input: VersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { definitionId, ...input },
        responseCode: 200,
        scope: 'platform.workflow-definition.publish.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const definition = await transaction.workflowDefinition.findFirst({
          where: { id: definitionId, tenantId: context.tenantId },
        });
        if (!definition)
          throw new AppError(
            'WORKFLOW_DEFINITION_NOT_FOUND',
            'Workflow definition was not found',
            404,
          );
        if (
          definition.status !== 'DRAFT' ||
          definition.version !== input.expectedVersion
        ) {
          throw this.versionConflict();
        }
        validateWorkflowGraph(
          definition.definition as unknown as WorkflowGraph,
        );
        const published = await transaction.workflowDefinition.update({
          data: {
            publishedAt: new Date(),
            status: 'PUBLISHED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: definition.id },
        });
        await this.record(
          transaction,
          published.id,
          published.version,
          'workflow.definition.published',
          'platform.workflow-definition-published.v1',
          context,
          metadata,
          {
            code: published.code,
            status: published.status,
            versionNumber: published.versionNumber,
          },
          { status: definition.status },
        );
        return {
          definitionId: published.id,
          status: published.status,
          version: published.version,
          versionNumber: published.versionNumber,
        };
      },
    );
  }

  start(
    input: StartWorkflowInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const code = input.definitionCode?.trim().toUpperCase();
    if (
      !CODE_PATTERN.test(code) ||
      !CODE_PATTERN.test(input.businessDomain) ||
      !CODE_PATTERN.test(input.objectType) ||
      !isUuid(input.objectId) ||
      !input.businessRef?.trim() ||
      (input.organizationId !== undefined && !isUuid(input.organizationId))
    ) {
      throw new AppError(
        'WORKFLOW_START_INVALID',
        'Workflow start input is invalid',
        400,
      );
    }
    if (
      context.accountKind === 'USER' &&
      input.organizationId &&
      !context.organizationIds.includes(input.organizationId)
    ) {
      throw new AppError(
        'WORKFLOW_SCOPE_DENIED',
        'Workflow organization is outside data scope',
        403,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 201,
        scope: 'platform.workflow-instance.start.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const definition = await transaction.workflowDefinition.findFirst({
          orderBy: { versionNumber: 'desc' },
          where: { code, status: 'PUBLISHED', tenantId: context.tenantId },
        });
        if (!definition)
          throw new AppError(
            'WORKFLOW_PUBLISHED_NOT_FOUND',
            'Published workflow was not found',
            404,
          );
        const graph = definition.definition as unknown as WorkflowGraph;
        validateWorkflowGraph(graph);
        const startNode = graph.nodes.find(
          ({ key }) => key === graph.startNodeKey,
        )!;
        if (startNode.type !== 'APPROVAL') {
          throw new AppError(
            'WORKFLOW_START_NODE_INVALID',
            'Workflow must start with approval',
            409,
          );
        }
        const variables = input.variables ?? {};
        const candidates = await this.resolveCandidates(
          transaction,
          startNode.candidates!,
          variables,
          context,
        );
        const workflowInstanceId = randomUUID();
        await transaction.workflowInstance.create({
          data: {
            businessDomain: input.businessDomain,
            businessRef: input.businessRef.trim(),
            createdBy: context.accountId,
            currentNodeKey: startNode.key,
            definitionCode: definition.code,
            definitionSnapshot: graph as unknown as Prisma.InputJsonObject,
            definitionVersionNumber: definition.versionNumber,
            id: workflowInstanceId,
            objectId: input.objectId,
            objectType: input.objectType,
            organizationId: input.organizationId ?? null,
            requesterId: context.accountId,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            variables: variables as Prisma.InputJsonObject,
            workflowDefinitionId: definition.id,
          },
        });
        await this.createTasks(
          transaction,
          workflowInstanceId,
          startNode,
          candidates,
          context,
        );
        await this.record(
          transaction,
          workflowInstanceId,
          1,
          'workflow.instance.started',
          'platform.workflow-instance-started.v1',
          context,
          metadata,
          {
            candidateCount: candidates.length,
            definitionCode: definition.code,
            definitionVersionNumber: definition.versionNumber,
            status: 'PENDING',
          },
        );
        return {
          accepted: true,
          candidateCount: candidates.length,
          status: 'PENDING',
          version: 1,
          workflowInstanceId,
        };
      },
    );
  }

  command(
    approvalTaskId: string,
    input: ApprovalCommandInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (
      !isUuid(approvalTaskId) ||
      !['APPROVE', 'REJECT', 'RETURN', 'ADD_SIGN', 'TRANSFER'].includes(
        input.action,
      ) ||
      (['ADD_SIGN', 'TRANSFER'].includes(input.action) &&
        !isUuid(input.targetAccountId ?? '')) ||
      (input.comment?.length ?? 0) > 1000
    ) {
      throw new AppError(
        'APPROVAL_COMMAND_INVALID',
        'Approval command is invalid',
        400,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { approvalTaskId, ...input },
        responseCode: 200,
        scope: 'platform.approval-task.command.v1',
        tenantId: context.tenantId,
      },
      (transaction) =>
        this.applyTaskCommand(
          transaction,
          approvalTaskId,
          input,
          context,
          metadata,
        ),
    );
  }

  withdraw(
    workflowInstanceId: string,
    input: VersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { workflowInstanceId, ...input },
        responseCode: 200,
        scope: 'platform.workflow-instance.withdraw.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const instance = await transaction.workflowInstance.findFirst({
          where: { id: workflowInstanceId, tenantId: context.tenantId },
        });
        if (!instance)
          throw new AppError(
            'WORKFLOW_INSTANCE_NOT_FOUND',
            'Workflow instance was not found',
            404,
          );
        assertApprovalTransition(instance.status, 'WITHDRAW');
        if (instance.requesterId !== context.accountId) {
          throw new AppError(
            'WORKFLOW_WITHDRAW_DENIED',
            'Only the requester can withdraw',
            403,
          );
        }
        if (instance.version !== input.expectedVersion)
          throw this.versionConflict();
        await transaction.approvalTask.updateMany({
          data: {
            completedAt: new Date(),
            status: 'CANCELLED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            status: 'PENDING',
            tenantId: context.tenantId,
            workflowInstanceId,
          },
        });
        await transaction.workflowInstance.update({
          data: {
            completedAt: new Date(),
            status: 'CANCELLED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: instance.id },
        });
        await this.recordAction(
          transaction,
          instance,
          null,
          'WITHDRAW',
          'PENDING',
          'CANCELLED',
          {},
          context,
          metadata,
        );
        return {
          status: 'CANCELLED',
          version: instance.version + 1,
          workflowInstanceId,
        };
      },
    );
  }

  batch(
    input: BatchApprovalInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (
      !['APPROVE', 'REJECT', 'RETURN'].includes(input.action) ||
      !Array.isArray(input.tasks) ||
      input.tasks.length < 1 ||
      input.tasks.length > 100 ||
      new Set(input.tasks.map(({ approvalTaskId }) => approvalTaskId)).size !==
        input.tasks.length ||
      input.tasks.some(
        ({ approvalTaskId, expectedVersion }) =>
          !isUuid(approvalTaskId) || !Number.isInteger(expectedVersion),
      )
    ) {
      throw new AppError(
        'APPROVAL_BATCH_INVALID',
        'Batch approval input is invalid',
        400,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 200,
        scope: 'platform.approval-task.batch.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const results = [];
        for (const task of input.tasks) {
          results.push(
            await this.applyTaskCommand(
              transaction,
              task.approvalTaskId,
              {
                action: input.action,
                ...(input.comment === undefined
                  ? {}
                  : { comment: input.comment }),
                expectedVersion: task.expectedVersion,
              },
              context,
              metadata,
            ),
          );
        }
        return { processed: results.length, results };
      },
    );
  }

  private async applyTaskCommand(
    transaction: Prisma.TransactionClient,
    approvalTaskId: string,
    input: ApprovalCommandInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const task = await transaction.approvalTask.findFirst({
      where: { id: approvalTaskId, tenantId: context.tenantId },
    });
    if (!task)
      throw new AppError(
        'APPROVAL_TASK_NOT_FOUND',
        'Approval task was not found',
        404,
      );
    if (task.assigneeAccountId !== context.accountId) {
      throw new AppError(
        'APPROVAL_ASSIGNEE_DENIED',
        'Only the current assignee can act',
        403,
      );
    }
    if (task.status !== 'PENDING' || task.version !== input.expectedVersion) {
      throw this.versionConflict();
    }
    const instance = await transaction.workflowInstance.findFirst({
      where: { id: task.workflowInstanceId, tenantId: context.tenantId },
    });
    if (!instance)
      throw new AppError(
        'WORKFLOW_INSTANCE_NOT_FOUND',
        'Workflow instance was not found',
        404,
      );
    assertApprovalTransition(instance.status, input.action);
    if (input.action === 'ADD_SIGN' || input.action === 'TRANSFER') {
      const target = await transaction.account.findFirst({
        where: {
          id: input.targetAccountId!,
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      });
      if (!target)
        throw new AppError(
          'APPROVAL_TARGET_INVALID',
          'Target approver is unavailable',
          409,
        );
      if (input.action === 'TRANSFER') {
        await transaction.approvalTask.update({
          data: {
            completedAt: new Date(),
            status: 'TRANSFERRED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: task.id },
        });
      }
      const created = await transaction.approvalTask.create({
        data: {
          assigneeAccountId: target.id,
          candidateSnapshot: {
            source: input.action,
            targetAccountId: target.id,
          },
          createdBy: context.accountId,
          delegatedFromId: task.id,
          dueAt: task.dueAt,
          nodeKey: task.nodeKey,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          workflowInstanceId: instance.id,
        },
      });
      await this.recordAction(
        transaction,
        instance,
        task,
        input.action,
        task.status,
        input.action === 'TRANSFER' ? 'TRANSFERRED' : 'PENDING',
        input,
        context,
        metadata,
      );
      return {
        approvalTaskId: task.id,
        createdApprovalTaskId: created.id,
        status: instance.status,
        version: instance.version,
        workflowInstanceId: instance.id,
      };
    }
    const taskTarget =
      input.action === 'APPROVE'
        ? 'APPROVED'
        : input.action === 'REJECT'
          ? 'REJECTED'
          : 'RETURNED';
    await transaction.approvalTask.update({
      data: {
        completedAt: new Date(),
        status: taskTarget,
        updatedBy: context.accountId,
        version: { increment: 1 },
      },
      where: { id: task.id },
    });
    await transaction.approvalTask.updateMany({
      data: {
        completedAt: new Date(),
        status: 'CANCELLED',
        updatedBy: context.accountId,
        version: { increment: 1 },
      },
      where: {
        id: { not: task.id },
        nodeKey: task.nodeKey,
        status: 'PENDING',
        tenantId: context.tenantId,
        workflowInstanceId: instance.id,
      },
    });
    let instanceTarget: WorkflowInstanceStatus = taskTarget;
    let nextNodeKey = instance.currentNodeKey;
    if (input.action === 'APPROVE') {
      const graph = instance.definitionSnapshot as unknown as WorkflowGraph;
      const variables = instance.variables as JsonObject;
      const next = graph.transitions.find(
        (transition) =>
          transition.from === task.nodeKey &&
          (!transition.condition ||
            compareCondition(transition.condition, variables)),
      );
      if (!next)
        throw new AppError(
          'WORKFLOW_ROUTE_NOT_FOUND',
          'No workflow transition matched',
          409,
        );
      const node = graph.nodes.find(({ key }) => key === next.to)!;
      nextNodeKey = node.key;
      if (node.type === 'APPROVAL') {
        instanceTarget = 'PENDING';
        const candidates = await this.resolveCandidates(
          transaction,
          node.candidates!,
          variables,
          context,
        );
        await this.createTasks(
          transaction,
          instance.id,
          node,
          candidates,
          context,
        );
      }
    }
    await transaction.workflowInstance.update({
      data: {
        ...(instanceTarget === 'PENDING' ? {} : { completedAt: new Date() }),
        currentNodeKey: nextNodeKey,
        status: instanceTarget,
        updatedBy: context.accountId,
        version: { increment: 1 },
      },
      where: { id: instance.id },
    });
    await this.recordAction(
      transaction,
      instance,
      task,
      input.action,
      instance.status,
      instanceTarget,
      input,
      context,
      metadata,
    );
    return {
      approvalTaskId: task.id,
      status: instanceTarget,
      version: instance.version + 1,
      workflowInstanceId: instance.id,
    };
  }

  private async resolveCandidates(
    transaction: Prisma.TransactionClient,
    selector: CandidateSelector,
    variables: JsonObject,
    context: TenantContext,
  ): Promise<readonly string[]> {
    if (
      (selector.conditions ?? []).some(
        (condition) => !compareCondition(condition, variables),
      )
    ) {
      throw new AppError(
        'WORKFLOW_CANDIDATE_CONDITION_UNMET',
        'Candidate condition was not met',
        409,
      );
    }
    const ids = new Set(selector.accountIds ?? []);
    const roleCodes = selector.roleCodes ?? [];
    const organizationIds = selector.organizationIds ?? [];
    if (roleCodes.length || organizationIds.length) {
      const roles = roleCodes.length
        ? await transaction.role.findMany({
            select: { id: true },
            where: {
              code: { in: [...roleCodes] },
              status: 'ACTIVE',
              tenantId: context.tenantId,
            },
          })
        : [];
      if (roleCodes.length && roles.length === 0) {
        throw new AppError(
          'WORKFLOW_CANDIDATE_EMPTY',
          'Workflow candidate role was not found',
          409,
        );
      }
      const assignments = await transaction.accountRole.findMany({
        select: { accountId: true },
        where: {
          ...(organizationIds.length
            ? { organizationId: { in: [...organizationIds] } }
            : {}),
          ...(roles.length
            ? { roleId: { in: roles.map(({ id }) => id) } }
            : {}),
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      });
      assignments.forEach(({ accountId }) => ids.add(accountId));
    }
    const accounts = await transaction.account.findMany({
      select: { id: true },
      where: {
        id: { in: [...ids] },
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    if (!accounts.length) {
      throw new AppError(
        'WORKFLOW_CANDIDATE_EMPTY',
        'Workflow node has no active candidates',
        409,
      );
    }
    return accounts.map(({ id }) => id);
  }

  private createTasks(
    transaction: Prisma.TransactionClient,
    workflowInstanceId: string,
    node: WorkflowNode,
    candidates: readonly string[],
    context: TenantContext,
  ) {
    const dueAt = node.timeoutMinutes
      ? new Date(Date.now() + node.timeoutMinutes * 60_000)
      : null;
    return transaction.approvalTask.createMany({
      data: candidates.map((assigneeAccountId) => ({
        assigneeAccountId,
        candidateSnapshot: {
          nodeKey: node.key,
          selector: node.candidates,
        } as Prisma.InputJsonObject,
        createdBy: context.accountId,
        dueAt,
        nodeKey: node.key,
        tenantId: context.tenantId,
        updatedBy: context.accountId,
        workflowInstanceId,
      })),
    });
  }

  private async recordAction(
    transaction: Prisma.TransactionClient,
    instance: { id: string; version: number },
    task: { id: string; status: string } | null,
    action: ApprovalActionType,
    fromStatus: string,
    toStatus: string,
    input: { comment?: string; targetAccountId?: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    await transaction.approvalAction.create({
      data: {
        action,
        actorAccountId: context.accountId,
        approvalTaskId: task?.id ?? null,
        comment: input.comment?.trim() || null,
        createdBy: context.accountId,
        fromStatus,
        metadata: {},
        targetAccountId: input.targetAccountId ?? null,
        tenantId: context.tenantId,
        toStatus,
        updatedBy: context.accountId,
        workflowInstanceId: instance.id,
      },
    });
    await this.record(
      transaction,
      instance.id,
      action === 'ADD_SIGN' || action === 'TRANSFER'
        ? instance.version
        : instance.version + 1,
      `approval.${action.toLowerCase()}`,
      `platform.approval-${action.toLowerCase().replace('_', '-')}.v1`,
      context,
      metadata,
      {
        action,
        approvalTaskId: task?.id ?? null,
        fromStatus,
        targetAccountId: input.targetAccountId ?? null,
        toStatus,
      },
    );
  }

  private async record(
    transaction: Prisma.TransactionClient,
    aggregateId: string,
    aggregateVersion: number,
    action: string,
    eventName: string,
    context: TenantContext,
    metadata: CommandMetadata,
    after: Prisma.InputJsonObject,
    before?: Prisma.InputJsonObject,
  ) {
    await Promise.all([
      transaction.platformAuditLog.create({
        data: {
          action,
          after,
          ...(before ? { before } : {}),
          category: 'APPROVAL',
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          deviceId: context.deviceId,
          ipAddress: metadata.ipAddress ?? null,
          resourceId: aggregateId,
          resourceType: 'Workflow',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      transaction.platformOutbox.create({
        data: {
          aggregateId,
          aggregateType: 'Workflow',
          aggregateVersion,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          eventName,
          payload: {
            aggregateId,
            tenantId: context.tenantId,
            version: aggregateVersion,
          },
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
    ]);
  }

  private versionConflict() {
    return new AppError(
      'WORKFLOW_VERSION_CONFLICT',
      'Workflow definition, instance or task version changed; refresh and retry',
      409,
      { retryable: true },
    );
  }
}
