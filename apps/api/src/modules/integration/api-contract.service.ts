import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../database/prisma.service';
import { ChangeRecordingFacade } from '../platform/public/change-recording.facade';
import type { CommandMetadata } from '../platform/tenant.service';

type JsonObject = Readonly<Record<string, unknown>>;

export interface CreateApiDefinitionInput {
  readonly name: string;
  readonly routeBase: string;
  readonly title: string;
}

export interface CreateApiVersionInput {
  readonly breakingChange?: boolean;
  readonly errorCodes: readonly JsonObject[];
  readonly examples: JsonObject;
  readonly semanticVersion: string;
  readonly specification: JsonObject;
}

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
const hash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
export class ApiContractService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChangeRecordingFacade)
    private readonly changes: ChangeRecordingFacade,
  ) {}

  async workbench(context: TenantContext) {
    const where = { tenantId: context.tenantId };
    const [definitions, versions, notices] = await Promise.all([
      this.prisma.integrationApiDefinition.findMany({
        orderBy: { updatedAt: 'desc' },
        where,
      }),
      this.prisma.integrationApiDefinitionVersion.findMany({
        orderBy: { createdAt: 'desc' },
        where,
      }),
      this.prisma.integrationDeprecationNotice.findMany({
        orderBy: { deprecationDate: 'desc' },
        where,
      }),
    ]);
    return { definitions, notices, versions };
  }

  createDefinition(
    input: CreateApiDefinitionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const name = this.text(input.name, 'name', 100).toLowerCase();
    const title = this.text(input.title, 'title', 200);
    const routeBase = this.text(input.routeBase, 'routeBase', 200);
    if (!/^[a-z][a-z0-9-]*$/.test(name))
      this.invalid('name must be a lowercase API identifier');
    if (!routeBase.startsWith('/api/'))
      this.invalid('routeBase must start with /api/');
    return this.prisma.$transaction(async (tx) => {
      const definition = await tx.integrationApiDefinition.create({
        data: {
          createdBy: context.accountId,
          name,
          routeBase,
          tenantId: context.tenantId,
          title,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        definition.id,
        definition.version,
        'integration.api-definition-created.v1',
        context,
        metadata,
        { name, status: definition.status },
      );
      return definition;
    });
  }

  createVersion(
    definitionId: string,
    input: CreateApiVersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const semanticVersion = this.semanticVersion(input.semanticVersion);
    const majorVersion = Number(semanticVersion.split('.')[0]);
    this.specification(input.specification, input.examples, input.errorCodes);
    return this.prisma.$transaction(async (tx) => {
      const definition = await tx.integrationApiDefinition.findFirst({
        where: { id: definitionId, tenantId: context.tenantId },
      });
      if (!definition)
        throw new AppError(
          'API_DEFINITION_NOT_FOUND',
          'API definition was not found',
          404,
        );
      const version = await tx.integrationApiDefinitionVersion.create({
        data: {
          breakingChange: input.breakingChange ?? false,
          createdBy: context.accountId,
          definitionId,
          errorCodes: json(input.errorCodes),
          examples: json(input.examples),
          majorVersion,
          semanticVersion,
          specHash: hash(input.specification),
          specification: json(input.specification),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        definitionId,
        version.version,
        'integration.api-definition-version-created.v1',
        context,
        metadata,
        { semanticVersion, status: version.status },
      );
      return version;
    });
  }

  publishVersion(
    id: string,
    input: { readonly expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.integrationApiDefinitionVersion.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!current)
        throw new AppError(
          'API_DEFINITION_VERSION_NOT_FOUND',
          'API definition version was not found',
          404,
        );
      this.version(current.version, input.expectedVersion);
      if (current.status !== 'DRAFT')
        throw new AppError(
          'API_DEFINITION_TRANSITION_INVALID',
          'Only draft API versions can be published',
          409,
        );
      const latest = await tx.integrationApiDefinitionVersion.findFirst({
        orderBy: [{ majorVersion: 'desc' }, { publishedAt: 'desc' }],
        where: {
          definitionId: current.definitionId,
          status: { in: ['PUBLISHED', 'DEPRECATED'] },
          tenantId: context.tenantId,
        },
      });
      if (
        latest &&
        current.breakingChange &&
        current.majorVersion <= latest.majorVersion
      )
        throw new AppError(
          'API_BREAKING_CHANGE_REQUIRES_MAJOR_VERSION',
          'Breaking API changes must use a new major version',
          409,
        );
      if (latest && current.majorVersion < latest.majorVersion)
        throw new AppError(
          'API_VERSION_REGRESSION',
          'Published API major version cannot move backwards',
          409,
        );
      const changed = await tx.integrationApiDefinitionVersion.update({
        data: {
          publishedAt: new Date(),
          status: 'PUBLISHED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await tx.integrationApiDefinition.update({
        data: {
          status: 'PUBLISHED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: current.definitionId },
      });
      await this.record(
        tx,
        current.definitionId,
        changed.version,
        'integration.api-definition-published.v1',
        context,
        metadata,
        { semanticVersion: changed.semanticVersion, status: changed.status },
      );
      return changed;
    });
  }

  deprecateVersion(
    id: string,
    input: {
      readonly deprecationDate: string;
      readonly expectedVersion: number;
      readonly replacementVersion?: string;
      readonly summary: string;
      readonly sunsetDate: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const deprecationDate = this.date(input.deprecationDate, 'deprecationDate');
    const sunsetDate = this.date(input.sunsetDate, 'sunsetDate');
    if (sunsetDate <= deprecationDate)
      this.invalid('sunsetDate must be after deprecationDate');
    const summary = this.text(input.summary, 'summary', 1000);
    const replacementVersion = input.replacementVersion
      ? this.semanticVersion(input.replacementVersion)
      : undefined;
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.integrationApiDefinitionVersion.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!current)
        throw new AppError(
          'API_DEFINITION_VERSION_NOT_FOUND',
          'API definition version was not found',
          404,
        );
      this.version(current.version, input.expectedVersion);
      if (current.status !== 'PUBLISHED')
        throw new AppError(
          'API_DEFINITION_TRANSITION_INVALID',
          'Only published API versions can be deprecated',
          409,
        );
      const notice = await tx.integrationDeprecationNotice.create({
        data: {
          createdBy: context.accountId,
          definitionVersionId: id,
          deprecationDate,
          ...(replacementVersion ? { replacementVersion } : {}),
          summary,
          sunsetDate,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const changed = await tx.integrationApiDefinitionVersion.update({
        data: {
          deprecatedAt: deprecationDate,
          status: 'DEPRECATED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(
        tx,
        current.definitionId,
        changed.version,
        'integration.api-definition-deprecated.v1',
        context,
        metadata,
        {
          deprecationNoticeId: notice.id,
          semanticVersion: changed.semanticVersion,
          sunsetDate: sunsetDate.toISOString(),
        },
      );
      return { notice, version: changed };
    });
  }

  async publicSpecification(
    tenantId: string,
    name: string,
    semanticVersion: string,
  ) {
    const definition = await this.prisma.integrationApiDefinition.findFirst({
      where: {
        name: name.toLowerCase(),
        status: { in: ['PUBLISHED', 'DEPRECATED'] },
        tenantId,
      },
    });
    if (!definition)
      throw new AppError(
        'API_DEFINITION_NOT_FOUND',
        'Published API definition was not found',
        404,
      );
    const version = await this.prisma.integrationApiDefinitionVersion.findFirst(
      {
        where: {
          definitionId: definition.id,
          semanticVersion,
          status: { in: ['PUBLISHED', 'DEPRECATED'] },
          tenantId: definition.tenantId,
        },
      },
    );
    if (!version)
      throw new AppError(
        'API_DEFINITION_VERSION_NOT_FOUND',
        'Published API definition version was not found',
        404,
      );
    const notice = await this.prisma.integrationDeprecationNotice.findFirst({
      where: {
        definitionVersionId: version.id,
        tenantId: definition.tenantId,
      },
    });
    return {
      definition: {
        name: definition.name,
        routeBase: definition.routeBase,
        title: definition.title,
      },
      deprecation: notice,
      errorCodes: version.errorCodes,
      examples: version.examples,
      specification: version.specification,
      version: version.semanticVersion,
    };
  }

  private specification(
    specification: JsonObject,
    examples: JsonObject,
    errorCodes: readonly JsonObject[],
  ): void {
    if (
      !String(specification.openapi ?? '').startsWith('3.') ||
      !specification.info ||
      !specification.paths
    )
      this.invalid('specification must be a valid OpenAPI 3 document');
    if (Object.keys(examples).length === 0)
      this.invalid('API examples are required');
    if (
      errorCodes.length === 0 ||
      errorCodes.some((entry) => !entry.code || !entry.message)
    )
      this.invalid('API error codes with code and message are required');
  }

  private semanticVersion(value: string): string {
    const normalized = this.text(value, 'semanticVersion', 30);
    if (!/^\d+\.\d+\.\d+$/.test(normalized) || normalized.startsWith('0.'))
      this.invalid('semanticVersion must use positive major semver');
    return normalized;
  }

  private date(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) this.invalid(`${field} is invalid`);
    return date;
  }

  private text(value: string, field: string, maximum: number): string {
    const normalized = value?.trim();
    if (!normalized || normalized.length > maximum)
      this.invalid(`${field} is invalid`);
    return normalized;
  }

  private version(actual: number, expected: number): void {
    if (!Number.isSafeInteger(expected) || actual !== expected)
      throw new AppError(
        'API_DEFINITION_VERSION_CONFLICT',
        'API definition version conflict',
        409,
      );
  }

  private invalid(message: string): never {
    throw new AppError('API_DEFINITION_INPUT_INVALID', message, 400);
  }

  private record(
    tx: Prisma.TransactionClient,
    id: string,
    version: number,
    eventName: string,
    context: TenantContext,
    metadata: CommandMetadata,
    payload: JsonObject,
  ) {
    return this.changes.record(
      tx,
      {
        aggregateId: id,
        aggregateType: 'IntegrationApiDefinition',
        aggregateVersion: version,
        eventName,
        payload: json(payload) as Prisma.InputJsonObject,
      },
      context,
      metadata,
    );
  }
}
