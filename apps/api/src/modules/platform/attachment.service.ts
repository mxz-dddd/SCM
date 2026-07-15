import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type FileObjectStatus,
  type VirusScanStatus,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { IdempotencyService } from './idempotency.service';
import { ObjectStorageService } from './object-storage.service';
import type { CommandMetadata } from './tenant.service';
import { WatermarkService } from './watermark.service';

interface AttachmentLinkInput {
  readonly businessDomain: string;
  readonly businessRef: string;
  readonly objectId: string;
  readonly objectType: string;
  readonly organizationId?: string;
  readonly relationType?: string;
}

export interface CreateUploadInput {
  readonly checksumSha256: string;
  readonly contentType: string;
  readonly link?: AttachmentLinkInput;
  readonly originalName: string;
  readonly retentionDays?: number;
  readonly sensitive?: boolean;
  readonly sizeBytes: number;
  readonly supersedesFileObjectId?: string;
}

export interface CompleteUploadInput {
  readonly expectedVersion: number;
}

export interface RecordScanInput {
  readonly details?: Readonly<Record<string, unknown>>;
  readonly engine: string;
  readonly engineVersion: string;
  readonly expectedVersion: number;
  readonly result: Exclude<VirusScanStatus, 'PENDING'>;
}

export interface CreateAttachmentLinkInput extends AttachmentLinkInput {
  readonly expectedVersion: number;
}

export interface IssueDownloadInput {
  readonly expectedVersion: number;
}

export interface ListAttachmentQuery {
  readonly businessDomain?: string;
  readonly objectId?: string;
  readonly page?: number | string;
  readonly pageSize?: number | string;
  readonly search?: string;
  readonly status?: FileObjectStatus;
}

const MIME_PATTERN =
  /^(application\/(json|pdf|zip|vnd\.openxmlformats-officedocument\.[a-z.]+)|image\/(gif|jpeg|png|webp)|text\/(csv|plain))$/;
const WATERMARK_MIME_PATTERN =
  /^(application\/(json|pdf)|image\/(gif|jpeg|png|webp)|text\/(csv|plain))$/;
const IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9_-]{1,99}$/;

export function assertAttachmentTransition(
  current: FileObjectStatus,
  target: FileObjectStatus,
): void {
  const allowed =
    (current === 'PENDING_UPLOAD' && target === 'SCANNING') ||
    (current === 'SCANNING' &&
      ['AVAILABLE', 'QUARANTINED', 'REJECTED'].includes(target)) ||
    (current === 'AVAILABLE' && target === 'EXPIRED');
  if (!allowed) {
    throw new AppError(
      'ATTACHMENT_TRANSITION_INVALID',
      `Attachment transition ${current} -> ${target} is not allowed`,
      409,
    );
  }
}

function normalizePage(query: ListAttachmentQuery) {
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 20);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  ) {
    throw new AppError('PAGINATION_INVALID', 'Invalid page or pageSize', 400);
  }
  return { page, pageSize };
}

function validateLink(link: AttachmentLinkInput): void {
  if (
    !IDENTIFIER_PATTERN.test(link.businessDomain) ||
    !IDENTIFIER_PATTERN.test(link.objectType) ||
    !IDENTIFIER_PATTERN.test(link.relationType ?? 'ATTACHMENT') ||
    !isUuid(link.objectId) ||
    (link.organizationId !== undefined && !isUuid(link.organizationId)) ||
    !link.businessRef?.trim() ||
    link.businessRef.length > 200
  ) {
    throw new AppError(
      'ATTACHMENT_LINK_INVALID',
      'Attachment business object link is invalid',
      400,
    );
  }
}

function targetForScan(result: Exclude<VirusScanStatus, 'PENDING'>) {
  if (result === 'CLEAN') return 'AVAILABLE' as const;
  if (result === 'INFECTED') return 'QUARANTINED' as const;
  return 'REJECTED' as const;
}

export function attachmentDownloadScopeAllowed(
  links: readonly { readonly organizationId: string | null }[],
  context: TenantContext,
): boolean {
  if (context.accountKind !== 'USER') return true;
  return (
    links.length > 0 &&
    links.some(
      ({ organizationId }) =>
        organizationId === null ||
        context.organizationIds.includes(organizationId),
    )
  );
}

@Injectable()
export class AttachmentService {
  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(ObjectStorageService)
    private readonly objects: ObjectStorageService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WatermarkService)
    private readonly watermarks: WatermarkService,
  ) {}

  async list(context: TenantContext, query: ListAttachmentQuery) {
    const { page, pageSize } = normalizePage(query);
    if (query.objectId && !isUuid(query.objectId)) {
      throw new AppError(
        'ATTACHMENT_OBJECT_ID_INVALID',
        'objectId must be a UUID',
        400,
      );
    }
    const links =
      query.businessDomain || query.objectId
        ? await this.prisma.attachmentLink.findMany({
            select: { fileObjectId: true },
            where: {
              ...(query.businessDomain
                ? { businessDomain: query.businessDomain }
                : {}),
              ...(query.objectId ? { objectId: query.objectId } : {}),
              status: 'ACTIVE',
              tenantId: context.tenantId,
            },
          })
        : undefined;
    const where: Prisma.FileObjectWhereInput = {
      ...(links
        ? { id: { in: links.map(({ fileObjectId }) => fileObjectId) } }
        : {}),
      ...(query.search?.trim()
        ? {
            originalName: {
              contains: query.search.trim(),
              mode: 'insensitive' as const,
            },
          }
        : {}),
      ...(query.status ? { status: query.status } : {}),
      tenantId: context.tenantId,
    };
    const [items, total] = await Promise.all([
      this.prisma.fileObject.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        where,
      }),
      this.prisma.fileObject.count({ where }),
    ]);
    const attachmentLinks = await this.prisma.attachmentLink.findMany({
      where: {
        fileObjectId: { in: items.map(({ id }) => id) },
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    return {
      items: items.map((item) => ({
        ...item,
        links: attachmentLinks.filter(
          ({ fileObjectId }) => fileObjectId === item.id,
        ),
        sizeBytes: item.sizeBytes.toString(),
      })),
      page,
      pageSize,
      total,
    };
  }

  async createUpload(
    input: CreateUploadInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.validateUpload(input);
    if (input.link) {
      validateLink(input.link);
      this.assertOrganizationScope(input.link.organizationId, context);
    }
    if (
      input.supersedesFileObjectId !== undefined &&
      !isUuid(input.supersedesFileObjectId)
    ) {
      throw new AppError(
        'ATTACHMENT_VERSION_REFERENCE_INVALID',
        'supersedesFileObjectId must be a UUID',
        400,
      );
    }
    await this.objects.ensureBucket();
    const uploadExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const retentionUntil = new Date(
      Date.now() + (input.retentionDays ?? 365) * 86_400_000,
    );
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 201,
        scope: 'platform.attachment.upload.create.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const superseded = input.supersedesFileObjectId
          ? await transaction.fileObject.findFirst({
              where: {
                id: input.supersedesFileObjectId,
                tenantId: context.tenantId,
              },
            })
          : null;
        if (input.supersedesFileObjectId && !superseded) {
          throw new AppError(
            'ATTACHMENT_VERSION_REFERENCE_NOT_FOUND',
            'The superseded attachment does not exist in this tenant',
            404,
          );
        }
        const contentVersion = (superseded?.contentVersion ?? 0) + 1;
        const fileObjectId = randomUUID();
        const cleanName = input.originalName
          .trim()
          .replace(/[^a-zA-Z0-9._-]+/g, '_')
          .slice(-120);
        const now = new Date();
        const objectKey = `${context.tenantId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${fileObjectId}/${cleanName}`;
        const signed = this.objects.presign({
          expiresSeconds: 900,
          headers: {
            'content-type': input.contentType,
            'x-amz-checksum-sha256': Buffer.from(
              input.checksumSha256,
              'hex',
            ).toString('base64'),
            'x-amz-meta-sha256': input.checksumSha256.toLowerCase(),
          },
          method: 'PUT',
          objectKey,
        });
        await transaction.fileObject.create({
          data: {
            bucket: this.objects.bucket,
            checksumSha256: input.checksumSha256.toLowerCase(),
            contentVersion,
            contentType: input.contentType,
            createdBy: context.accountId,
            id: fileObjectId,
            objectKey,
            originalName: input.originalName.trim(),
            retentionUntil,
            sensitive: input.sensitive ?? false,
            sizeBytes: BigInt(input.sizeBytes),
            supersedesFileObjectId: input.supersedesFileObjectId ?? null,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            uploadExpiresAt,
          },
        });
        if (input.link) {
          await this.createLinkRecord(
            transaction,
            fileObjectId,
            input.link,
            context,
          );
        }
        await this.recordChange(transaction, {
          action: 'attachment.upload.requested',
          after: {
            contentType: input.contentType,
            originalName: input.originalName,
            sensitive: input.sensitive ?? false,
            sizeBytes: input.sizeBytes,
            status: 'PENDING_UPLOAD',
          },
          aggregateId: fileObjectId,
          aggregateVersion: 1,
          ...(input.link?.businessRef
            ? { businessRef: input.link.businessRef }
            : {}),
          context,
          eventName: 'platform.attachment-upload-requested.v1',
          metadata,
        });
        return {
          accepted: true,
          contentVersion,
          fileObjectId,
          headers: signed.headers,
          status: 'PENDING_UPLOAD',
          uploadExpiresAt: uploadExpiresAt.toISOString(),
          uploadUrl: signed.url,
          version: 1,
        };
      },
    );
  }

  async completeUpload(
    fileObjectId: string,
    input: CompleteUploadInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const candidate = await this.findFile(fileObjectId, context);
    const object = await this.objects.headObject(candidate.objectKey);
    if (
      object.contentLength !== Number(candidate.sizeBytes) ||
      object.contentType.split(';')[0]?.trim() !== candidate.contentType ||
      object.checksumSha256?.toLowerCase() !== candidate.checksumSha256
    ) {
      throw new AppError(
        'ATTACHMENT_UPLOAD_METADATA_MISMATCH',
        'Uploaded object size, type or checksum metadata does not match the request',
        409,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { fileObjectId, ...input },
        responseCode: 202,
        scope: 'platform.attachment.upload.complete.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const file = await transaction.fileObject.findFirst({
          where: { id: fileObjectId, tenantId: context.tenantId },
        });
        if (!file) throw this.notFound();
        assertAttachmentTransition(file.status, 'SCANNING');
        if (file.version !== input.expectedVersion)
          throw this.versionConflict();
        const changed = await transaction.fileObject.updateMany({
          data: {
            etag: object.etag,
            status: 'SCANNING',
            updatedBy: context.accountId,
            uploadedAt: new Date(),
            version: { increment: 1 },
          },
          where: {
            id: file.id,
            status: 'PENDING_UPLOAD',
            tenantId: context.tenantId,
            version: file.version,
          },
        });
        if (changed.count !== 1) throw this.versionConflict();
        await this.recordChange(transaction, {
          action: 'attachment.upload.completed',
          after: { scanStatus: 'PENDING', status: 'SCANNING' },
          aggregateId: file.id,
          aggregateVersion: file.version + 1,
          before: { scanStatus: file.scanStatus, status: file.status },
          context,
          eventName: 'platform.attachment-scan-requested.v1',
          metadata,
        });
        return {
          accepted: true,
          fileObjectId: file.id,
          status: 'SCANNING',
          version: file.version + 1,
        };
      },
    );
  }

  recordScan(
    fileObjectId: string,
    input: RecordScanInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (
      !['CLEAN', 'INFECTED', 'ERROR'].includes(input.result) ||
      !input.engine?.trim() ||
      !input.engineVersion?.trim()
    ) {
      throw new AppError(
        'ATTACHMENT_SCAN_RESULT_INVALID',
        'Scan result, engine and engineVersion are required',
        400,
      );
    }
    const target = targetForScan(input.result);
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { fileObjectId, ...input },
        responseCode: 200,
        scope: 'platform.attachment.scan.record.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const file = await transaction.fileObject.findFirst({
          where: { id: fileObjectId, tenantId: context.tenantId },
        });
        if (!file) throw this.notFound();
        assertAttachmentTransition(file.status, target);
        if (file.version !== input.expectedVersion)
          throw this.versionConflict();
        const changed = await transaction.fileObject.updateMany({
          data: {
            scanDetails: (input.details ?? {}) as Prisma.InputJsonObject,
            scanEngine: input.engine.trim(),
            scanEngineVersion: input.engineVersion.trim(),
            scannedAt: new Date(),
            scanStatus: input.result,
            status: target,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            id: file.id,
            status: 'SCANNING',
            tenantId: context.tenantId,
            version: file.version,
          },
        });
        if (changed.count !== 1) throw this.versionConflict();
        await this.recordChange(transaction, {
          action: 'attachment.scan.recorded',
          after: { scanStatus: input.result, status: target },
          aggregateId: file.id,
          aggregateVersion: file.version + 1,
          before: { scanStatus: file.scanStatus, status: file.status },
          context,
          eventName: `platform.attachment-${target.toLowerCase()}.v1`,
          metadata,
        });
        return {
          fileObjectId: file.id,
          scanStatus: input.result,
          status: target,
          version: file.version + 1,
        };
      },
    );
  }

  createLink(
    fileObjectId: string,
    input: CreateAttachmentLinkInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    validateLink(input);
    this.assertOrganizationScope(input.organizationId, context);
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { fileObjectId, ...input },
        responseCode: 201,
        scope: 'platform.attachment.link.create.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const file = await transaction.fileObject.findFirst({
          where: { id: fileObjectId, tenantId: context.tenantId },
        });
        if (!file) throw this.notFound();
        if (['QUARANTINED', 'REJECTED', 'EXPIRED'].includes(file.status)) {
          throw new AppError(
            'ATTACHMENT_LINK_STATE_INVALID',
            'Unavailable attachments cannot be linked',
            409,
          );
        }
        if (file.version !== input.expectedVersion)
          throw this.versionConflict();
        const linkId = await this.createLinkRecord(
          transaction,
          file.id,
          input,
          context,
        );
        await transaction.fileObject.update({
          data: { updatedBy: context.accountId, version: { increment: 1 } },
          where: { id: file.id },
        });
        await this.recordChange(transaction, {
          action: 'attachment.link.created',
          after: {
            businessDomain: input.businessDomain,
            businessRef: input.businessRef,
            objectId: input.objectId,
            objectType: input.objectType,
          },
          aggregateId: file.id,
          aggregateVersion: file.version + 1,
          businessRef: input.businessRef,
          context,
          eventName: 'platform.attachment-linked.v1',
          metadata,
        });
        return {
          attachmentLinkId: linkId,
          fileObjectId: file.id,
          status: file.status,
          version: file.version + 1,
        };
      },
    );
  }

  async issueDownload(
    fileObjectId: string,
    input: IssueDownloadInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const file = await this.findFile(fileObjectId, context);
    const links = await this.prisma.attachmentLink.findMany({
      where: {
        fileObjectId,
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    this.assertDownloadable(file, input.expectedVersion);
    this.assertDownloadScope(links, context);
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { fileObjectId, ...input },
        responseCode: 201,
        scope: 'platform.attachment.download.issue.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        let downloadUrl: string;
        let expiresAt: Date;
        if (file.sensitive) {
          const token = randomBytes(32).toString('base64url');
          expiresAt = new Date(Date.now() + 5 * 60 * 1000);
          await transaction.attachmentDownloadGrant.create({
            data: {
              accountId: context.accountId,
              correlationId: metadata.correlationId,
              createdBy: context.accountId,
              expiresAt,
              fileObjectId: file.id,
              tenantId: context.tenantId,
              tokenHash: createHash('sha256').update(token).digest('hex'),
              updatedBy: context.accountId,
              watermarkText: `${context.accountId} · ${metadata.correlationId}`,
            },
          });
          downloadUrl = `/api/v1/platform/attachments/downloads/${token}`;
        } else {
          const signed = this.objects.presign({
            expiresSeconds: 300,
            method: 'GET',
            objectKey: file.objectKey,
          });
          downloadUrl = signed.url;
          expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        }
        await transaction.platformAuditLog.create({
          data: {
            action: file.sensitive
              ? 'attachment.sensitive-download.issued'
              : 'attachment.download.issued',
            businessRef: links[0]?.businessRef ?? null,
            category: 'SENSITIVE_QUERY',
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            deviceId: context.deviceId,
            ipAddress: metadata.ipAddress ?? null,
            resourceId: file.id,
            resourceType: 'FileObject',
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        return {
          downloadUrl,
          expiresAt: expiresAt.toISOString(),
          fileObjectId: file.id,
          sensitive: file.sensitive,
          version: file.version,
        };
      },
    );
  }

  async consumeDownload(token: string, context: TenantContext) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const grant = await this.prisma.attachmentDownloadGrant.findFirst({
      where: {
        accountId: context.accountId,
        status: 'ACTIVE',
        tenantId: context.tenantId,
        tokenHash,
      },
    });
    if (!grant || grant.expiresAt <= new Date()) {
      throw new AppError(
        'ATTACHMENT_DOWNLOAD_GRANT_INVALID',
        'Download grant is invalid, expired or already consumed',
        410,
      );
    }
    const file = await this.findFile(grant.fileObjectId, context);
    this.assertDownloadable(file, file.version);
    const source = await this.objects.download(file.objectKey);
    const watermarked = await this.watermarks.apply(
      source,
      file.contentType,
      grant.watermarkText,
    );
    const consumed = await this.prisma.attachmentDownloadGrant.updateMany({
      data: {
        consumedAt: new Date(),
        status: 'CONSUMED',
        updatedBy: context.accountId,
        version: { increment: 1 },
      },
      where: { id: grant.id, status: 'ACTIVE', version: grant.version },
    });
    if (consumed.count !== 1) {
      throw new AppError(
        'ATTACHMENT_DOWNLOAD_GRANT_CONSUMED',
        'Download grant was already consumed',
        409,
      );
    }
    return {
      body: watermarked.body,
      contentType: watermarked.contentType,
      fileName: file.originalName,
    };
  }

  private validateUpload(input: CreateUploadInput): void {
    const maximum = Number(
      process.env.ATTACHMENT_MAX_BYTES ?? 25 * 1024 * 1024,
    );
    const retentionDays = input.retentionDays ?? 365;
    if (
      !input.originalName?.trim() ||
      input.originalName.length > 255 ||
      !MIME_PATTERN.test(input.contentType) ||
      !Number.isSafeInteger(input.sizeBytes) ||
      input.sizeBytes < 1 ||
      input.sizeBytes > maximum ||
      !/^[a-fA-F0-9]{64}$/.test(input.checksumSha256) ||
      !Number.isInteger(retentionDays) ||
      retentionDays < 1 ||
      retentionDays > 3650
    ) {
      throw new AppError(
        'ATTACHMENT_UPLOAD_INVALID',
        'Attachment name, type, size, checksum or retention is invalid',
        400,
      );
    }
    if (input.sensitive && !WATERMARK_MIME_PATTERN.test(input.contentType)) {
      throw new AppError(
        'ATTACHMENT_WATERMARK_TYPE_UNSUPPORTED',
        'Sensitive attachment type cannot be watermarked',
        400,
      );
    }
  }

  private async findFile(fileObjectId: string, context: TenantContext) {
    if (!isUuid(fileObjectId)) throw this.notFound();
    const file = await this.prisma.fileObject.findFirst({
      where: { id: fileObjectId, tenantId: context.tenantId },
    });
    if (!file) throw this.notFound();
    return file;
  }

  private assertOrganizationScope(
    organizationId: string | undefined,
    context: TenantContext,
  ): void {
    if (
      context.accountKind === 'USER' &&
      organizationId &&
      !context.organizationIds.includes(organizationId)
    ) {
      throw new AppError(
        'ATTACHMENT_SCOPE_DENIED',
        'The business object is outside the current data scope',
        403,
      );
    }
  }

  private assertDownloadScope(
    links: readonly { readonly organizationId: string | null }[],
    context: TenantContext,
  ): void {
    if (!attachmentDownloadScopeAllowed(links, context)) {
      throw new AppError(
        'ATTACHMENT_SCOPE_DENIED',
        'The attachment is outside the current data scope',
        403,
      );
    }
  }

  private assertDownloadable(
    file: {
      readonly retentionUntil: Date;
      readonly status: FileObjectStatus;
      readonly version: number;
    },
    expectedVersion: number,
  ): void {
    if (file.version !== expectedVersion) throw this.versionConflict();
    if (file.status !== 'AVAILABLE') {
      throw new AppError(
        'ATTACHMENT_DOWNLOAD_STATE_INVALID',
        'Only clean available attachments can be downloaded',
        409,
      );
    }
    if (file.retentionUntil <= new Date()) {
      throw new AppError(
        'ATTACHMENT_RETENTION_EXPIRED',
        'Attachment retention period has expired',
        410,
      );
    }
  }

  private async createLinkRecord(
    transaction: Prisma.TransactionClient,
    fileObjectId: string,
    input: AttachmentLinkInput,
    context: TenantContext,
  ) {
    const id = randomUUID();
    await transaction.attachmentLink.create({
      data: {
        businessDomain: input.businessDomain,
        businessRef: input.businessRef.trim(),
        createdBy: context.accountId,
        fileObjectId,
        id,
        objectId: input.objectId,
        objectType: input.objectType,
        organizationId: input.organizationId ?? null,
        relationType: input.relationType ?? 'ATTACHMENT',
        tenantId: context.tenantId,
        updatedBy: context.accountId,
      },
    });
    return id;
  }

  private async recordChange(
    transaction: Prisma.TransactionClient,
    input: {
      readonly action: string;
      readonly after: Prisma.InputJsonObject;
      readonly aggregateId: string;
      readonly aggregateVersion: number;
      readonly before?: Prisma.InputJsonObject;
      readonly businessRef?: string;
      readonly context: TenantContext;
      readonly eventName: string;
      readonly metadata: CommandMetadata;
    },
  ) {
    await transaction.platformAuditLog.create({
      data: {
        action: input.action,
        after: input.after,
        ...(input.before ? { before: input.before } : {}),
        businessRef: input.businessRef ?? null,
        correlationId: input.metadata.correlationId,
        createdBy: input.context.accountId,
        deviceId: input.context.deviceId,
        ipAddress: input.metadata.ipAddress ?? null,
        resourceId: input.aggregateId,
        resourceType: 'FileObject',
        tenantId: input.context.tenantId,
        updatedBy: input.context.accountId,
      },
    });
    await transaction.platformOutbox.create({
      data: {
        aggregateId: input.aggregateId,
        aggregateType: 'FileObject',
        aggregateVersion: input.aggregateVersion,
        correlationId: input.metadata.correlationId,
        createdBy: input.context.accountId,
        eventName: input.eventName,
        payload: {
          fileObjectId: input.aggregateId,
          tenantId: input.context.tenantId,
          version: input.aggregateVersion,
        },
        tenantId: input.context.tenantId,
        updatedBy: input.context.accountId,
      },
    });
  }

  private notFound() {
    return new AppError(
      'ATTACHMENT_NOT_FOUND',
      'Attachment was not found in the current tenant',
      404,
    );
  }

  private versionConflict() {
    return new AppError(
      'ATTACHMENT_VERSION_CONFLICT',
      'Attachment version changed; refresh and retry',
      409,
      { retryable: true },
    );
  }
}
