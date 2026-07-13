import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type ImportJobStatus } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { IdempotencyService } from './idempotency.service';
import { ObjectStorageService } from './object-storage.service';
import { parseTabularFile } from './tabular-file';
import type { CommandMetadata } from './tenant.service';

type ColumnType = 'DATE' | 'NUMBER' | 'STRING' | 'UUID';

export interface ImportColumnRule {
  readonly allowedValues?: readonly string[];
  readonly name: string;
  readonly required?: boolean;
  readonly type?: ColumnType;
}

export interface CreateImportInput {
  readonly columnRules: readonly ImportColumnRule[];
  readonly fileObjectId: string;
  readonly importType: string;
  readonly uniqueColumns?: readonly string[];
}

export interface VersionInput {
  readonly expectedVersion: number;
}

export interface CompleteImportInput extends VersionInput {
  readonly failureCode?: string;
  readonly processedRows: number;
  readonly success: boolean;
}

const IMPORT_TYPE_PATTERN = /^[A-Z][A-Z0-9_.-]{2,99}$/;
const COLUMN_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$/;

export function assertImportTransition(
  current: ImportJobStatus,
  target: ImportJobStatus,
): void {
  const allowed =
    (current === 'UPLOADED' && target === 'VALIDATING') ||
    (current === 'VALIDATING' && ['READY', 'FAILED'].includes(target)) ||
    (current === 'READY' && target === 'IMPORTING') ||
    (current === 'IMPORTING' && ['COMPLETED', 'FAILED'].includes(target));
  if (!allowed) {
    throw new AppError(
      'IMPORT_TRANSITION_INVALID',
      `Import transition ${current} -> ${target} is not allowed`,
      409,
    );
  }
}

interface RowError {
  readonly code: string;
  readonly columnName: string;
  readonly message: string;
  readonly rowNumber: number;
  readonly valueSnapshot?: string;
}

function valueMatchesType(value: string, type: ColumnType): boolean {
  if (type === 'STRING') return true;
  if (type === 'NUMBER')
    return value.trim() !== '' && Number.isFinite(Number(value));
  if (type === 'UUID') return isUuid(value);
  return (
    (!Number.isNaN(Date.parse(value)) && value.trim() !== '') ||
    (Number.isFinite(Number(value)) && Number(value) > 0)
  );
}

export function validateImportRows(
  headers: readonly string[],
  rows: readonly Readonly<Record<string, string>>[],
  configuration: {
    readonly columnRules: readonly ImportColumnRule[];
    readonly uniqueColumns?: readonly string[];
  },
): readonly RowError[] {
  const errors: RowError[] = [];
  for (const rule of configuration.columnRules) {
    if (!headers.includes(rule.name)) {
      errors.push({
        code: 'COLUMN_MISSING',
        columnName: rule.name,
        message: 'Required configured column is missing',
        rowNumber: 1,
      });
    }
  }
  const uniqueColumns = configuration.uniqueColumns ?? [];
  const seen = new Map<string, number>();
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    for (const rule of configuration.columnRules) {
      const value = row[rule.name] ?? '';
      if (rule.required && !value.trim()) {
        errors.push({
          code: 'VALUE_REQUIRED',
          columnName: rule.name,
          message: 'Value is required',
          rowNumber,
        });
      } else if (value && rule.type && !valueMatchesType(value, rule.type)) {
        errors.push({
          code: 'VALUE_TYPE_INVALID',
          columnName: rule.name,
          message: `Value must be ${rule.type}`,
          rowNumber,
          valueSnapshot: value.slice(0, 500),
        });
      } else if (
        value &&
        rule.allowedValues &&
        !rule.allowedValues.includes(value)
      ) {
        errors.push({
          code: 'DICTIONARY_VALUE_INVALID',
          columnName: rule.name,
          message: 'Value is not in the allowed dictionary snapshot',
          rowNumber,
          valueSnapshot: value.slice(0, 500),
        });
      }
    }
    if (uniqueColumns.length) {
      const key = uniqueColumns
        .map((column) => row[column] ?? '')
        .join('\u001f');
      const previous = seen.get(key);
      if (previous !== undefined) {
        errors.push({
          code: 'DUPLICATE_BUSINESS_KEY',
          columnName: uniqueColumns.join(','),
          message: `Duplicate of row ${previous}`,
          rowNumber,
          valueSnapshot: key.slice(0, 500),
        });
      } else {
        seen.set(key, rowNumber);
      }
    }
  });
  return errors;
}

@Injectable()
export class ImportService {
  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(ObjectStorageService)
    private readonly objects: ObjectStorageService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  list(context: TenantContext) {
    return this.prisma.importJob.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      where: { tenantId: context.tenantId },
    });
  }

  listErrors(importJobId: string, context: TenantContext) {
    return this.prisma.importRowError.findMany({
      orderBy: [{ rowNumber: 'asc' }, { columnName: 'asc' }],
      take: 1000,
      where: { importJobId, tenantId: context.tenantId },
    });
  }

  create(
    input: CreateImportInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const importType = input.importType?.trim().toUpperCase();
    const uniqueColumns = [...new Set(input.uniqueColumns ?? [])];
    if (
      !isUuid(input.fileObjectId) ||
      !IMPORT_TYPE_PATTERN.test(importType) ||
      !Array.isArray(input.columnRules) ||
      input.columnRules.length === 0 ||
      input.columnRules.some(
        (rule) =>
          !COLUMN_PATTERN.test(rule.name) ||
          (rule.type &&
            !['STRING', 'NUMBER', 'DATE', 'UUID'].includes(rule.type)) ||
          (rule.allowedValues && rule.allowedValues.length > 1000),
      ) ||
      uniqueColumns.some(
        (column) =>
          !COLUMN_PATTERN.test(column) ||
          !input.columnRules.some((rule) => rule.name === column),
      )
    ) {
      throw new AppError(
        'IMPORT_CONFIGURATION_INVALID',
        'Import configuration is invalid',
        400,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 201,
        scope: 'platform.import-job.create.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const file = await transaction.fileObject.findFirst({
          where: {
            id: input.fileObjectId,
            status: 'AVAILABLE',
            tenantId: context.tenantId,
          },
        });
        if (!file) {
          throw new AppError(
            'IMPORT_FILE_UNAVAILABLE',
            'Import file must be a clean available attachment',
            409,
          );
        }
        const format = file.originalName.toLowerCase().endsWith('.csv')
          ? 'CSV'
          : file.originalName.toLowerCase().endsWith('.xlsx')
            ? 'XLSX'
            : null;
        if (!format) {
          throw new AppError(
            'IMPORT_FILE_FORMAT_INVALID',
            'Import file must be CSV or XLSX',
            400,
          );
        }
        const id = randomUUID();
        await transaction.importJob.create({
          data: {
            configuration: {
              columnRules: input.columnRules.map((rule) => ({
                ...(rule.allowedValues
                  ? { allowedValues: [...rule.allowedValues] }
                  : {}),
                name: rule.name,
                ...(rule.required === undefined
                  ? {}
                  : { required: rule.required }),
                ...(rule.type ? { type: rule.type } : {}),
              })),
              uniqueColumns,
            },
            createdBy: context.accountId,
            fileName: file.originalName,
            fileObjectId: file.id,
            format,
            id,
            importType,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        await this.record(
          transaction,
          id,
          1,
          'import.job.uploaded',
          'platform.import-uploaded.v1',
          context,
          metadata,
          {
            format,
            status: 'UPLOADED',
          },
        );
        return {
          accepted: true,
          importJobId: id,
          status: 'UPLOADED',
          version: 1,
        };
      },
    );
  }

  transition(
    importJobId: string,
    target: 'IMPORTING' | 'VALIDATING',
    input: VersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { importJobId, target, ...input },
        responseCode: 202,
        scope: `platform.import-job.${target.toLowerCase()}.v1`,
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const job = await this.findJob(transaction, importJobId, context);
        assertImportTransition(job.status, target);
        if (job.version !== input.expectedVersion) throw this.versionConflict();
        await transaction.importJob.update({
          data: {
            ...(target === 'VALIDATING'
              ? { validationStartedAt: new Date() }
              : { importStartedAt: new Date() }),
            status: target,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: job.id },
        });
        await this.record(
          transaction,
          job.id,
          job.version + 1,
          `import.job.${target.toLowerCase()}`,
          `platform.import-${target.toLowerCase()}.v1`,
          context,
          metadata,
          { status: target },
          { status: job.status },
        );
        return {
          accepted: true,
          importJobId: job.id,
          status: target,
          version: job.version + 1,
        };
      },
    );
  }

  processValidation(
    importJobId: string,
    input: VersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { importJobId, ...input },
        responseCode: 200,
        scope: 'platform.import-job.validation-result.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const job = await this.findJob(transaction, importJobId, context);
        if (
          job.status !== 'VALIDATING' ||
          job.version !== input.expectedVersion
        ) {
          throw this.versionConflict();
        }
        const file = await transaction.fileObject.findFirst({
          where: { id: job.fileObjectId, tenantId: context.tenantId },
        });
        if (!file)
          throw new AppError(
            'IMPORT_FILE_UNAVAILABLE',
            'Import file is unavailable',
            409,
          );
        const source = await this.objects.download(file.objectKey);
        const table = parseTabularFile(source, job.format);
        const configuration = job.configuration as unknown as {
          columnRules: ImportColumnRule[];
          uniqueColumns?: string[];
        };
        const errors = validateImportRows(
          table.headers,
          table.rows,
          configuration,
        );
        for (const error of errors) {
          await transaction.importRowError.create({
            data: {
              code: error.code,
              columnName: error.columnName,
              createdBy: context.accountId,
              importJobId: job.id,
              message: error.message,
              rowNumber: error.rowNumber,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
              valueSnapshot: error.valueSnapshot ?? null,
            },
          });
        }
        const invalidRows = new Set(errors.map(({ rowNumber }) => rowNumber));
        const target = errors.length ? 'FAILED' : 'READY';
        assertImportTransition(job.status, target);
        const receipt = {
          errorCount: errors.length,
          errorRows: invalidRows.size,
          headers: table.headers,
          totalRows: table.rows.length,
          validRows: table.rows.length - invalidRows.size,
        };
        await transaction.importJob.update({
          data: {
            errorRows: invalidRows.size,
            failureCode: errors.length ? 'IMPORT_VALIDATION_FAILED' : null,
            receipt,
            status: target,
            totalRows: table.rows.length,
            updatedBy: context.accountId,
            validatedAt: new Date(),
            validRows: table.rows.length - invalidRows.size,
            version: { increment: 1 },
          },
          where: { id: job.id },
        });
        await this.record(
          transaction,
          job.id,
          job.version + 1,
          'import.validation.completed',
          `platform.import-${target.toLowerCase()}.v1`,
          context,
          metadata,
          {
            ...receipt,
            status: target,
          },
        );
        return {
          importJobId: job.id,
          receipt,
          status: target,
          version: job.version + 1,
        };
      },
    );
  }

  complete(
    importJobId: string,
    input: CompleteImportInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (!Number.isInteger(input.processedRows) || input.processedRows < 0) {
      throw new AppError(
        'IMPORT_RESULT_INVALID',
        'processedRows is invalid',
        400,
      );
    }
    const target = input.success ? 'COMPLETED' : 'FAILED';
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { importJobId, ...input },
        responseCode: 200,
        scope: 'platform.import-job.complete.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const job = await this.findJob(transaction, importJobId, context);
        assertImportTransition(job.status, target);
        if (job.version !== input.expectedVersion) throw this.versionConflict();
        if (input.success && input.processedRows !== job.validRows) {
          throw new AppError(
            'IMPORT_RESULT_COUNT_MISMATCH',
            'Successful import must process every validated row',
            409,
          );
        }
        const receipt = {
          ...(job.receipt as Prisma.JsonObject),
          completedAt: new Date().toISOString(),
          processedRows: input.processedRows,
          success: input.success,
        };
        await transaction.importJob.update({
          data: {
            completedAt: new Date(),
            failureCode: input.success
              ? null
              : (input.failureCode ?? 'IMPORT_PROCESSING_FAILED'),
            processedRows: input.processedRows,
            receipt,
            status: target,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: job.id },
        });
        await this.record(
          transaction,
          job.id,
          job.version + 1,
          'import.processing.completed',
          `platform.import-${target.toLowerCase()}.v1`,
          context,
          metadata,
          {
            processedRows: input.processedRows,
            status: target,
          },
        );
        return {
          importJobId: job.id,
          receipt,
          status: target,
          version: job.version + 1,
        };
      },
    );
  }

  private async findJob(
    transaction: Prisma.TransactionClient,
    id: string,
    context: TenantContext,
  ) {
    const job = await transaction.importJob.findFirst({
      where: { id, tenantId: context.tenantId },
    });
    if (!job)
      throw new AppError(
        'IMPORT_JOB_NOT_FOUND',
        'Import job was not found',
        404,
      );
    return job;
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
    await transaction.platformAuditLog.create({
      data: {
        action,
        after,
        ...(before ? { before } : {}),
        correlationId: metadata.correlationId,
        createdBy: context.accountId,
        deviceId: context.deviceId,
        ipAddress: metadata.ipAddress ?? null,
        resourceId: aggregateId,
        resourceType: 'ImportJob',
        tenantId: context.tenantId,
        updatedBy: context.accountId,
      },
    });
    await transaction.platformOutbox.create({
      data: {
        aggregateId,
        aggregateType: 'ImportJob',
        aggregateVersion,
        correlationId: metadata.correlationId,
        createdBy: context.accountId,
        eventName,
        payload: {
          importJobId: aggregateId,
          tenantId: context.tenantId,
          version: aggregateVersion,
        },
        tenantId: context.tenantId,
        updatedBy: context.accountId,
      },
    });
  }

  private versionConflict() {
    return new AppError(
      'IMPORT_VERSION_CONFLICT',
      'Import job version or state changed; refresh and retry',
      409,
      { retryable: true },
    );
  }
}
