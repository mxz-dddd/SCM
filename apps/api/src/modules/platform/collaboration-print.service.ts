import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type CommentStatus,
  type PrintJobStatus,
  type PrintTemplateStatus,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { IdempotencyService } from './idempotency.service';
import { PrintQueueService } from './print-queue.service';
import type { CommandMetadata } from './tenant.service';

type JsonObject = Readonly<Record<string, unknown>>;

export interface CreateCommentInput {
  readonly attachmentIds?: readonly string[];
  readonly body: string;
  readonly businessId: string;
  readonly businessType: string;
  readonly mentionedAccountIds?: readonly string[];
  readonly visibility: 'EXTERNAL' | 'INTERNAL';
}

export interface VersionInput {
  readonly expectedVersion: number;
}

export interface SavePrintTemplateInput {
  readonly code: string;
  readonly content: JsonObject;
  readonly customerId?: string;
  readonly documentType: string;
  readonly language: string;
  readonly name: string;
  readonly routeTags?: readonly string[];
  readonly variables?: readonly string[];
  readonly warehouseId?: string;
}

export interface SavePrinterInput {
  readonly code: string;
  readonly endpointRef: string;
  readonly name: string;
  readonly routeTags?: readonly string[];
  readonly warehouseId?: string;
}

export interface CreatePrintJobInput {
  readonly businessId: string;
  readonly copies?: number;
  readonly customerId?: string;
  readonly documentType: string;
  readonly labelData: JsonObject;
  readonly language: string;
  readonly printerId?: string;
  readonly warehouseId?: string;
}

export interface ClaimPrintJobInput {
  readonly expectedVersion: number;
  readonly leaseOwner: string;
  readonly leaseSeconds?: number;
}

export interface CompletePrintJobInput {
  readonly expectedVersion: number;
  readonly failureCode?: string;
  readonly leaseOwner: string;
  readonly success: boolean;
}

const CODE_PATTERN = /^[A-Z][A-Z0-9_.-]{2,99}$/;
const TYPE_PATTERN = /^[A-Z][A-Z0-9_.-]{2,99}$/;

export function assertCommentTransition(
  current: CommentStatus,
  target: CommentStatus,
): void {
  if (!(
    (current === 'OPEN' && target === 'RESOLVED') ||
    (current === 'RESOLVED' && target === 'OPEN')
  )) {
    throw new AppError(
      'COMMENT_TRANSITION_INVALID',
      `Comment transition ${current} -> ${target} is not allowed`,
      409,
    );
  }
}

export function assertPrintTemplateTransition(
  current: PrintTemplateStatus,
  target: PrintTemplateStatus,
): void {
  if (!(
    (current === 'DRAFT' && target === 'PUBLISHED') ||
    (current === 'PUBLISHED' && target === 'RETIRED')
  )) {
    throw new AppError(
      'PRINT_TEMPLATE_TRANSITION_INVALID',
      `Print template transition ${current} -> ${target} is not allowed`,
      409,
    );
  }
}

export function assertPrintJobTransition(
  current: PrintJobStatus,
  target: PrintJobStatus,
): void {
  const allowed =
    (current === 'QUEUED' && ['CANCELLED', 'PRINTING'].includes(target)) ||
    (current === 'FAILED' && target === 'PRINTING') ||
    (current === 'PRINTING' &&
      ['CANCELLED', 'COMPLETED', 'FAILED'].includes(target));
  if (!allowed)
    throw new AppError(
      'PRINT_JOB_TRANSITION_INVALID',
      `Print job transition ${current} -> ${target} is not allowed`,
      409,
    );
}

@Injectable()
export class CollaborationPrintService {
  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(PrintQueueService) private readonly queue: PrintQueueService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  listComments(
    businessType: string,
    businessId: string,
    externalOnly: boolean,
    context: TenantContext,
  ) {
    if (!TYPE_PATTERN.test(businessType) || !isUuid(businessId)) {
      throw new AppError(
        'COMMENT_TARGET_INVALID',
        'Comment target is invalid',
        400,
      );
    }
    return this.prisma.businessComment.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 500,
      where: {
        businessId,
        businessType,
        tenantId: context.tenantId,
        ...(externalOnly ? { visibility: 'EXTERNAL' } : {}),
      },
    });
  }

  createComment(
    input: CreateCommentInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const businessType = input.businessType?.trim().toUpperCase();
    const mentions = [...new Set(input.mentionedAccountIds ?? [])];
    const attachments = [...new Set(input.attachmentIds ?? [])];
    if (
      !TYPE_PATTERN.test(businessType) ||
      !isUuid(input.businessId) ||
      !input.body?.trim() ||
      input.body.length > 4000 ||
      !['EXTERNAL', 'INTERNAL'].includes(input.visibility) ||
      [...mentions, ...attachments].some((id) => !isUuid(id))
    ) {
      throw new AppError('COMMENT_INVALID', 'Comment input is invalid', 400);
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 201,
        scope: 'platform.comment.create.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const [accounts, files] = await Promise.all([
          transaction.account.count({
            where: { id: { in: mentions }, tenantId: context.tenantId },
          }),
          transaction.fileObject.count({
            where: {
              id: { in: attachments },
              status: 'AVAILABLE',
              tenantId: context.tenantId,
            },
          }),
        ]);
        if (accounts !== mentions.length || files !== attachments.length) {
          throw new AppError(
            'COMMENT_REFERENCE_INVALID',
            'Mention or attachment is unavailable',
            409,
          );
        }
        const comment = await transaction.businessComment.create({
          data: {
            attachmentIds: attachments as Prisma.InputJsonArray,
            body: input.body.trim(),
            businessId: input.businessId,
            businessType,
            createdBy: context.accountId,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            visibility: input.visibility,
          },
        });
        if (mentions.length) {
          await transaction.commentMention.createMany({
            data: mentions.map((mentionedAccountId) => ({
              commentId: comment.id,
              createdBy: context.accountId,
              mentionedAccountId,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            })),
          });
        }
        await this.record(
          transaction,
          comment.id,
          comment.version,
          'comment.created',
          'platform.comment-created.v1',
          context,
          metadata,
          {
            businessId: input.businessId,
            businessType,
            visibility: input.visibility,
          },
        );
        return {
          commentId: comment.id,
          status: comment.status,
          version: comment.version,
        };
      },
    );
  }

  changeCommentStatus(
    commentId: string,
    target: 'OPEN' | 'RESOLVED',
    input: VersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { commentId, target, ...input },
        responseCode: 200,
        scope: 'platform.comment.status.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const comment = await transaction.businessComment.findFirst({
          where: { id: commentId, tenantId: context.tenantId },
        });
        if (!comment)
          throw new AppError('COMMENT_NOT_FOUND', 'Comment was not found', 404);
        if (comment.version !== input.expectedVersion)
          throw this.versionConflict('COMMENT');
        assertCommentTransition(comment.status, target);
        const changed = await transaction.businessComment.update({
          data: {
            resolvedAt: target === 'RESOLVED' ? new Date() : null,
            resolvedBy: target === 'RESOLVED' ? context.accountId : null,
            status: target,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: comment.id },
        });
        await this.record(
          transaction,
          comment.id,
          changed.version,
          `comment.${target.toLowerCase()}`,
          `platform.comment-${target.toLowerCase()}.v1`,
          context,
          metadata,
          { status: target },
        );
        return {
          commentId: changed.id,
          status: changed.status,
          version: changed.version,
        };
      },
    );
  }

  listTemplates(context: TenantContext) {
    return this.prisma.printTemplate.findMany({
      orderBy: [{ code: 'asc' }, { versionNumber: 'desc' }],
      take: 300,
      where: { tenantId: context.tenantId },
    });
  }

  saveTemplate(
    input: SavePrintTemplateInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const code = input.code?.trim().toUpperCase();
    const documentType = input.documentType?.trim().toUpperCase();
    const variables = [...new Set(input.variables ?? [])];
    if (
      !CODE_PATTERN.test(code) ||
      !TYPE_PATTERN.test(documentType) ||
      !input.name?.trim() ||
      !['en-US', 'zh-CN'].includes(input.language) ||
      (input.customerId !== undefined && !isUuid(input.customerId)) ||
      (input.warehouseId !== undefined && !isUuid(input.warehouseId)) ||
      variables.some((name) => !/^[A-Za-z][A-Za-z0-9_.]{0,99}$/.test(name))
    )
      throw new AppError(
        'PRINT_TEMPLATE_INVALID',
        'Print template input is invalid',
        400,
      );
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 201,
        scope: 'platform.print-template.save.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const latest = await transaction.printTemplate.findFirst({
          orderBy: { versionNumber: 'desc' },
          where: { code, tenantId: context.tenantId },
        });
        const template = await transaction.printTemplate.create({
          data: {
            code,
            content: input.content as Prisma.InputJsonObject,
            createdBy: context.accountId,
            customerId: input.customerId ?? null,
            documentType,
            language: input.language,
            name: input.name.trim(),
            routeTags: (input.routeTags ?? []) as Prisma.InputJsonArray,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            variables: variables as Prisma.InputJsonArray,
            versionNumber: (latest?.versionNumber ?? 0) + 1,
            warehouseId: input.warehouseId ?? null,
          },
        });
        return {
          printTemplateId: template.id,
          status: template.status,
          version: template.version,
          versionNumber: template.versionNumber,
        };
      },
    );
  }

  changeTemplateStatus(
    templateId: string,
    target: 'PUBLISHED' | 'RETIRED',
    input: VersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { templateId, target, ...input },
        responseCode: 200,
        scope: 'platform.print-template.status.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const template = await transaction.printTemplate.findFirst({
          where: { id: templateId, tenantId: context.tenantId },
        });
        if (!template)
          throw new AppError(
            'PRINT_TEMPLATE_NOT_FOUND',
            'Print template was not found',
            404,
          );
        if (template.version !== input.expectedVersion)
          throw this.versionConflict('PRINT_TEMPLATE');
        assertPrintTemplateTransition(template.status, target);
        const changed = await transaction.printTemplate.update({
          data: {
            publishedAt:
              target === 'PUBLISHED' ? new Date() : template.publishedAt,
            status: target,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: template.id },
        });
        return {
          printTemplateId: changed.id,
          status: changed.status,
          version: changed.version,
        };
      },
    );
  }

  listPrinters(context: TenantContext) {
    return this.prisma.printer.findMany({
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      take: 300,
      where: { tenantId: context.tenantId },
    });
  }

  savePrinter(
    input: SavePrinterInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const code = input.code?.trim().toUpperCase();
    if (
      !CODE_PATTERN.test(code) ||
      !input.name?.trim() ||
      !input.endpointRef?.trim() ||
      (input.warehouseId !== undefined && !isUuid(input.warehouseId))
    ) {
      throw new AppError('PRINTER_INVALID', 'Printer input is invalid', 400);
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 201,
        scope: 'platform.printer.save.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const printer = await transaction.printer.create({
          data: {
            code,
            createdBy: context.accountId,
            endpointRef: input.endpointRef.trim(),
            name: input.name.trim(),
            routeTags: (input.routeTags ?? []) as Prisma.InputJsonArray,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            warehouseId: input.warehouseId ?? null,
          },
        });
        return {
          printerId: printer.id,
          status: printer.status,
          version: printer.version,
        };
      },
    );
  }

  listPrintJobs(context: TenantContext) {
    return this.prisma.printJob.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 300,
      where: { tenantId: context.tenantId },
    });
  }

  async getPrintJob(jobId: string, context: TenantContext) {
    const job = await this.prisma.printJob.findFirst({
      where: { id: jobId, tenantId: context.tenantId },
    });
    if (!job)
      throw new AppError('PRINT_JOB_NOT_FOUND', 'Print job was not found', 404);
    return job;
  }

  async createPrintJob(
    input: CreatePrintJobInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const documentType = input.documentType?.trim().toUpperCase();
    const copies = input.copies ?? 1;
    if (
      !TYPE_PATTERN.test(documentType) ||
      !isUuid(input.businessId) ||
      !['en-US', 'zh-CN'].includes(input.language) ||
      !Number.isInteger(copies) ||
      copies < 1 ||
      copies > 100 ||
      [input.customerId, input.warehouseId, input.printerId].some(
        (id) => id !== undefined && !isUuid(id),
      )
    )
      throw new AppError(
        'PRINT_JOB_INVALID',
        'Print job input is invalid',
        400,
      );
    const result = await this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 202,
        scope: 'platform.print-job.create.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const templates = await transaction.printTemplate.findMany({
          orderBy: { versionNumber: 'desc' },
          where: {
            documentType,
            language: input.language,
            status: 'PUBLISHED',
            tenantId: context.tenantId,
          },
        });
        const template = templates.find(
          (candidate) =>
            (!candidate.customerId ||
              candidate.customerId === input.customerId) &&
            (!candidate.warehouseId ||
              candidate.warehouseId === input.warehouseId),
        );
        if (!template)
          throw new AppError(
            'PRINT_TEMPLATE_NOT_FOUND',
            'No matching published template was found',
            404,
          );
        const variables = new Set(template.variables as string[]);
        if (Object.keys(input.labelData).some((key) => !variables.has(key))) {
          throw new AppError(
            'PRINT_VARIABLE_NOT_ALLOWED',
            'Label data contains an unapproved variable',
            400,
          );
        }
        const templateTags = template.routeTags as string[];
        const printer = input.printerId
          ? await transaction.printer.findFirst({
              where: {
                id: input.printerId,
                status: 'ACTIVE',
                tenantId: context.tenantId,
              },
            })
          : (
              await transaction.printer.findMany({
                orderBy: { code: 'asc' },
                where: { status: 'ACTIVE', tenantId: context.tenantId },
              })
            ).find(
              (candidate) =>
                (!candidate.warehouseId ||
                  candidate.warehouseId === input.warehouseId) &&
                (!templateTags.length ||
                  templateTags.some((tag) =>
                    (candidate.routeTags as string[]).includes(tag),
                  )),
            );
        if (!printer)
          throw new AppError(
            'PRINTER_ROUTE_NOT_FOUND',
            'No active printer matched the route',
            409,
          );
        const job = await transaction.printJob.create({
          data: {
            businessId: input.businessId,
            copies,
            createdBy: context.accountId,
            documentType,
            labelData: input.labelData as Prisma.InputJsonObject,
            printerId: printer.id,
            printTemplateId: template.id,
            routeSnapshot: {
              endpointRef: printer.endpointRef,
              printerCode: printer.code,
            },
            templateSnapshot: {
              content: template.content,
              variables: template.variables,
            },
            templateVersionNumber: template.versionNumber,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        await this.record(
          transaction,
          job.id,
          job.version,
          'print-job.queued',
          'platform.print-job-queued.v1',
          context,
          metadata,
          { printerId: printer.id, status: job.status },
        );
        return {
          accepted: true,
          printJobId: job.id,
          printerId: printer.id,
          status: job.status,
          version: job.version,
        };
      },
    );
    await this.queue.enqueue(result.printJobId, context.tenantId);
    return result;
  }

  claimPrintJob(
    jobId: string,
    input: ClaimPrintJobInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const leaseSeconds = input.leaseSeconds ?? 60;
    if (
      !input.leaseOwner?.trim() ||
      !Number.isInteger(leaseSeconds) ||
      leaseSeconds < 10 ||
      leaseSeconds > 3600
    ) {
      throw new AppError(
        'PRINT_JOB_LEASE_INVALID',
        'Print job lease is invalid',
        400,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { jobId, ...input },
        responseCode: 200,
        scope: 'platform.print-job.claim.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${context.tenantId}:${jobId}`}))`;
        const job = await transaction.printJob.findFirst({
          where: { id: jobId, tenantId: context.tenantId },
        });
        if (!job || job.version !== input.expectedVersion)
          throw this.versionConflict('PRINT_JOB');
        const stale =
          job.status === 'PRINTING' &&
          Boolean(job.leaseExpiresAt && job.leaseExpiresAt <= new Date());
        if (
          (!['FAILED', 'QUEUED'].includes(job.status) && !stale) ||
          job.attempt >= job.maxAttempts
        )
          throw this.versionConflict('PRINT_JOB');
        if (!stale) assertPrintJobTransition(job.status, 'PRINTING');
        const leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1000);
        const changed = await transaction.printJob.update({
          data: {
            attempt: { increment: 1 },
            failureCode: null,
            leaseExpiresAt,
            leaseOwner: input.leaseOwner.trim(),
            status: 'PRINTING',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: job.id },
        });
        return {
          attempt: changed.attempt,
          labelData: changed.labelData,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
          printJobId: changed.id,
          routeSnapshot: changed.routeSnapshot,
          status: changed.status,
          templateSnapshot: changed.templateSnapshot,
          version: changed.version,
        };
      },
    );
  }

  completePrintJob(
    jobId: string,
    input: CompletePrintJobInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (!input.leaseOwner?.trim())
      throw new AppError(
        'PRINT_JOB_RESULT_INVALID',
        'Print job result is invalid',
        400,
      );
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { jobId, ...input },
        responseCode: 200,
        scope: 'platform.print-job.complete.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const job = await transaction.printJob.findFirst({
          where: { id: jobId, tenantId: context.tenantId },
        });
        if (
          !job ||
          job.status !== 'PRINTING' ||
          job.version !== input.expectedVersion ||
          job.leaseOwner !== input.leaseOwner ||
          !job.leaseExpiresAt ||
          job.leaseExpiresAt <= new Date()
        ) {
          throw this.versionConflict('PRINT_JOB');
        }
        const target = input.success ? 'COMPLETED' : 'FAILED';
        assertPrintJobTransition(job.status, target);
        const changed = await transaction.printJob.update({
          data: {
            completedAt: input.success ? new Date() : null,
            failureCode: input.success
              ? null
              : (input.failureCode ?? 'PRINT_FAILED'),
            leaseExpiresAt: null,
            leaseOwner: null,
            status: target,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: job.id },
        });
        return {
          printJobId: changed.id,
          retryable: !input.success && changed.attempt < changed.maxAttempts,
          status: changed.status,
          version: changed.version,
        };
      },
    );
  }

  cancelPrintJob(
    jobId: string,
    input: VersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { jobId, ...input },
        responseCode: 200,
        scope: 'platform.print-job.cancel.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const job = await transaction.printJob.findFirst({
          where: { id: jobId, tenantId: context.tenantId },
        });
        if (!job || job.version !== input.expectedVersion)
          throw this.versionConflict('PRINT_JOB');
        assertPrintJobTransition(job.status, 'CANCELLED');
        const changed = await transaction.printJob.update({
          data: {
            completedAt: new Date(),
            leaseExpiresAt: null,
            leaseOwner: null,
            status: 'CANCELLED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: job.id },
        });
        return {
          printJobId: changed.id,
          status: changed.status,
          version: changed.version,
        };
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
  ) {
    await Promise.all([
      transaction.platformAuditLog.create({
        data: {
          action,
          after,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          deviceId: context.deviceId,
          ipAddress: metadata.ipAddress ?? null,
          resourceId: aggregateId,
          resourceType: action.startsWith('comment')
            ? 'BusinessComment'
            : 'PrintJob',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      transaction.platformOutbox.create({
        data: {
          aggregateId,
          aggregateType: action.startsWith('comment')
            ? 'BusinessComment'
            : 'PrintJob',
          aggregateVersion,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          eventName,
          payload: { id: aggregateId, tenantId: context.tenantId },
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
    ]);
  }

  private versionConflict(resource: string) {
    return new AppError(
      `${resource}_VERSION_CONFLICT`,
      `${resource} changed; refresh and retry`,
      409,
      { retryable: true },
    );
  }
}
