import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type BarcodeStatus,
  type PackageSpecStatus,
  type ProductCategoryStatus,
  type ProductStatus,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isPrismaErrorCode } from '../../common/prisma-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { IdempotencyService } from '../platform/idempotency.service';
import type { CommandMetadata } from '../platform/tenant.service';

export interface SaveCategoryInput {
  readonly code: string;
  readonly name: string;
  readonly parentId?: string;
}

export interface SaveProductInput {
  readonly baseUom: string;
  readonly batchControl?: 'NONE' | 'OPTIONAL' | 'REQUIRED';
  readonly categoryId?: string;
  readonly expectedVersion?: number;
  readonly hazardous?: boolean;
  readonly hazardousAttributes?: Readonly<Record<string, unknown>>;
  readonly minimumRemainingDays?: number;
  readonly name: string;
  readonly serialControl?: 'NONE' | 'OPTIONAL' | 'REQUIRED';
  readonly shelfLifeDays?: number;
  readonly sku: string;
  readonly temperatureZone?: 'AMBIENT' | 'CHILLED' | 'FROZEN' | 'CONTROLLED';
}

export interface VersionInput {
  readonly expectedVersion: number;
}

export interface SavePackageSpecInput {
  readonly baseUom: string;
  readonly code: string;
  readonly customerId?: string;
  readonly dimensionUom?: string;
  readonly grossWeight?: string;
  readonly height?: string;
  readonly length?: string;
  readonly level: 'EACH' | 'INNER' | 'CASE' | 'PALLET' | 'CUSTOM';
  readonly name: string;
  readonly netWeight?: string;
  readonly originalUom: string;
  readonly parentSpecId?: string;
  readonly productId: string;
  readonly quantityInBase: string;
  readonly volume?: string;
  readonly volumeUom?: string;
  readonly weightUom?: string;
  readonly width?: string;
}

export interface AddBarcodeInput {
  readonly barcode: string;
  readonly customerId?: string;
  readonly isPrimary?: boolean;
  readonly packageSpecId?: string;
  readonly productId: string;
  readonly type: 'GTIN' | 'EAN' | 'UPC' | 'GS1' | 'CUSTOMER' | 'INTERNAL';
}

export interface ConvertPackageQuantityInput {
  readonly amount: string;
}

export function assertProductTransition(
  current: ProductStatus,
  target: ProductStatus,
): void {
  if (!(
    (current === 'DRAFT' && target === 'ACTIVE') ||
    (current === 'ACTIVE' && target === 'INACTIVE')
  )) {
    throw new AppError(
      'PRODUCT_TRANSITION_INVALID',
      `Product transition ${current} -> ${target} is not allowed`,
      409,
    );
  }
}

export function assertPackageSpecTransition(
  current: PackageSpecStatus,
  target: PackageSpecStatus,
): void {
  if (!(
    (current === 'DRAFT' && target === 'PUBLISHED') ||
    (current === 'PUBLISHED' && target === 'RETIRED')
  )) {
    throw new AppError(
      'PACKAGE_SPEC_TRANSITION_INVALID',
      `Package specification transition ${current} -> ${target} is not allowed`,
      409,
    );
  }
}

export function assertCategoryTransition(
  current: ProductCategoryStatus,
  target: ProductCategoryStatus,
): void {
  if (!(current === 'ACTIVE' && target === 'INACTIVE')) {
    throw new AppError(
      'PRODUCT_CATEGORY_TRANSITION_INVALID',
      `Product category transition ${current} -> ${target} is not allowed`,
      409,
    );
  }
}

export function assertBarcodeTransition(
  current: BarcodeStatus,
  target: BarcodeStatus,
): void {
  if (!(current === 'ACTIVE' && target === 'INACTIVE')) {
    throw new AppError(
      'PRODUCT_BARCODE_TRANSITION_INVALID',
      `Product barcode transition ${current} -> ${target} is not allowed`,
      409,
    );
  }
}

const CODE = /^[A-Z0-9][A-Z0-9_.-]{0,99}$/;
const UOM = /^[A-Z][A-Z0-9_.-]{0,19}$/;

function required(
  value: string | undefined,
  field: string,
  max: number,
): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > max)
    throw new AppError(
      'MDM_INPUT_INVALID',
      `${field} is required and must not exceed ${max} characters`,
      400,
    );
  return normalized;
}

function decimal(
  value: string | undefined,
  field: string,
  allowZero = true,
): Prisma.Decimal | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = new Prisma.Decimal(value);
    if (
      !parsed.isFinite() ||
      parsed.isNegative() ||
      (!allowZero && parsed.isZero())
    )
      throw new Error('range');
    return parsed;
  } catch {
    throw new AppError(
      'MDM_DECIMAL_INVALID',
      `${field} must be a ${allowZero ? 'non-negative' : 'positive'} decimal string`,
      400,
    );
  }
}

function jsonObject(
  value: Readonly<Record<string, unknown>> | undefined,
): Prisma.InputJsonObject {
  return (value ?? {}) as Prisma.InputJsonObject;
}

@Injectable()
export class ProductService {
  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  listCategories(context: TenantContext) {
    return this.prisma.productCategory.findMany({
      orderBy: [{ path: 'asc' }, { code: 'asc' }],
      take: 500,
      where: { tenantId: context.tenantId },
    });
  }

  createCategory(
    input: SaveCategoryInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const code = required(input.code, 'code', 100).toUpperCase();
    const name = required(input.name, 'name', 200);
    if (
      !CODE.test(code) ||
      (input.parentId !== undefined && !isUuid(input.parentId))
    )
      throw new AppError(
        'PRODUCT_CATEGORY_INVALID',
        'Product category input is invalid',
        400,
      );
    return this.idempotency
      .execute(
        {
          actorId: context.accountId,
          key: metadata.idempotencyKey,
          payload: input,
          responseCode: 201,
          scope: 'mdm.product-category.create.v1',
          tenantId: context.tenantId,
        },
        async (transaction) => {
          const parent = input.parentId
            ? await transaction.productCategory.findFirst({
                where: {
                  id: input.parentId,
                  status: 'ACTIVE',
                  tenantId: context.tenantId,
                },
              })
            : null;
          if (input.parentId && !parent)
            throw new AppError(
              'PRODUCT_CATEGORY_PARENT_NOT_FOUND',
              'Active parent category was not found',
              404,
            );
          const id = randomUUID();
          const category = await transaction.productCategory.create({
            data: {
              code,
              createdBy: context.accountId,
              id,
              name,
              parentId: parent?.id ?? null,
              path: parent ? `${parent.path}/${id}` : `/${id}`,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          await this.record(
            transaction,
            'ProductCategory',
            category.id,
            category.version,
            'mdm.category-created.v1',
            'category.create',
            context,
            metadata,
            { code: category.code, status: category.status },
          );
          return {
            categoryId: category.id,
            status: category.status,
            version: category.version,
          };
        },
      )
      .catch((error: unknown) => {
        throw this.mapUnique(
          error,
          'PRODUCT_CATEGORY_CODE_CONFLICT',
          'Category code already exists',
        );
      });
  }

  deactivateCategory(
    categoryId: string,
    input: VersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.validateId(categoryId, 'PRODUCT_CATEGORY_NOT_FOUND');
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { categoryId, ...input },
        responseCode: 200,
        scope: 'mdm.product-category.deactivate.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const category = await transaction.productCategory.findFirst({
          where: { id: categoryId, tenantId: context.tenantId },
        });
        if (!category)
          throw new AppError(
            'PRODUCT_CATEGORY_NOT_FOUND',
            'Product category was not found',
            404,
          );
        this.expected(
          category.version,
          input.expectedVersion,
          'PRODUCT_CATEGORY_VERSION_CONFLICT',
        );
        assertCategoryTransition(category.status, 'INACTIVE');
        if (
          await transaction.product.count({
            where: {
              categoryId,
              status: { not: 'INACTIVE' },
              tenantId: context.tenantId,
            },
          })
        )
          throw new AppError(
            'PRODUCT_CATEGORY_IN_USE',
            'Category is used by an active product',
            409,
          );
        const changed = await transaction.productCategory.update({
          data: {
            status: 'INACTIVE',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: category.id },
        });
        await this.record(
          transaction,
          'ProductCategory',
          changed.id,
          changed.version,
          'mdm.category-inactivated.v1',
          'category.inactivate',
          context,
          metadata,
          { status: changed.status },
          { status: category.status },
        );
        return {
          categoryId: changed.id,
          status: changed.status,
          version: changed.version,
        };
      },
    );
  }

  listProducts(context: TenantContext, status?: ProductStatus) {
    return this.prisma.product.findMany({
      orderBy: [{ sku: 'asc' }, { id: 'asc' }],
      take: 500,
      where: { ...(status ? { status } : {}), tenantId: context.tenantId },
    });
  }

  async getProduct(productId: string, context: TenantContext) {
    this.validateId(productId, 'PRODUCT_NOT_FOUND');
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId: context.tenantId },
    });
    if (!product)
      throw new AppError('PRODUCT_NOT_FOUND', 'Product was not found', 404);
    const [barcodes, packageSpecs, versions] = await Promise.all([
      this.prisma.productBarcode.findMany({
        orderBy: [{ isPrimary: 'desc' }, { barcode: 'asc' }],
        where: { productId, tenantId: context.tenantId },
      }),
      this.prisma.packageSpec.findMany({
        orderBy: [{ code: 'asc' }, { versionNumber: 'desc' }],
        where: { productId, tenantId: context.tenantId },
      }),
      this.prisma.productVersion.findMany({
        orderBy: { versionNumber: 'desc' },
        where: { productId, tenantId: context.tenantId },
      }),
    ]);
    return { ...product, barcodes, packageSpecs, versions };
  }

  saveProduct(
    productId: string | undefined,
    input: SaveProductInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const sku = required(input.sku, 'sku', 100).toUpperCase();
    const name = required(input.name, 'name', 300);
    const baseUom = required(input.baseUom, 'baseUom', 20).toUpperCase();
    if (
      !CODE.test(sku) ||
      !UOM.test(baseUom) ||
      (input.categoryId !== undefined && !isUuid(input.categoryId))
    )
      throw new AppError('PRODUCT_INVALID', 'Product input is invalid', 400);
    if (
      (input.shelfLifeDays !== undefined &&
        (!Number.isInteger(input.shelfLifeDays) || input.shelfLifeDays <= 0)) ||
      (input.minimumRemainingDays !== undefined &&
        (!Number.isInteger(input.minimumRemainingDays) ||
          input.minimumRemainingDays < 0 ||
          input.shelfLifeDays === undefined ||
          input.minimumRemainingDays > input.shelfLifeDays))
    )
      throw new AppError(
        'PRODUCT_SHELF_LIFE_INVALID',
        'Shelf life and minimum remaining days are invalid',
        400,
      );
    return this.idempotency
      .execute(
        {
          actorId: context.accountId,
          key: metadata.idempotencyKey,
          payload: { productId, ...input },
          responseCode: productId ? 200 : 201,
          scope: productId ? 'mdm.product.update.v1' : 'mdm.product.create.v1',
          tenantId: context.tenantId,
        },
        async (transaction) => {
          const category = input.categoryId
            ? await transaction.productCategory.findFirst({
                where: {
                  id: input.categoryId,
                  status: 'ACTIVE',
                  tenantId: context.tenantId,
                },
              })
            : null;
          if (input.categoryId && !category)
            throw new AppError(
              'PRODUCT_CATEGORY_NOT_FOUND',
              'Active product category was not found',
              404,
            );
          const categorySnapshot = category
            ? {
                code: category.code,
                id: category.id,
                name: category.name,
                path: category.path,
              }
            : {};
          if (!productId) {
            const product = await transaction.product.create({
              data: {
                baseUom,
                batchControl: input.batchControl ?? 'NONE',
                categoryId: category?.id ?? null,
                categorySnapshot,
                createdBy: context.accountId,
                hazardous: input.hazardous ?? false,
                hazardousAttributes: jsonObject(input.hazardousAttributes),
                id: randomUUID(),
                minimumRemainingDays: input.minimumRemainingDays ?? null,
                name,
                serialControl: input.serialControl ?? 'NONE',
                shelfLifeDays: input.shelfLifeDays ?? null,
                sku,
                temperatureZone: input.temperatureZone ?? 'AMBIENT',
                tenantId: context.tenantId,
                updatedBy: context.accountId,
              },
            });
            await this.record(
              transaction,
              'Product',
              product.id,
              product.version,
              'mdm.product-created.v1',
              'product.create',
              context,
              metadata,
              { sku: product.sku, status: product.status },
            );
            return {
              productId: product.id,
              status: product.status,
              version: product.version,
            };
          }
          this.validateId(productId, 'PRODUCT_NOT_FOUND');
          const existing = await transaction.product.findFirst({
            where: { id: productId, tenantId: context.tenantId },
          });
          if (!existing)
            throw new AppError(
              'PRODUCT_NOT_FOUND',
              'Product was not found',
              404,
            );
          this.expected(
            existing.version,
            input.expectedVersion,
            'PRODUCT_VERSION_CONFLICT',
          );
          if (existing.status === 'INACTIVE')
            throw new AppError(
              'PRODUCT_INACTIVE',
              'Inactive product cannot be changed',
              409,
            );
          if (existing.sku !== sku)
            throw new AppError(
              'PRODUCT_SKU_IMMUTABLE',
              'Product SKU cannot be changed',
              409,
            );
          const product = await transaction.product.update({
            data: {
              baseUom,
              batchControl: input.batchControl ?? existing.batchControl,
              categoryId: category?.id ?? null,
              categorySnapshot,
              hazardous: input.hazardous ?? false,
              hazardousAttributes: jsonObject(input.hazardousAttributes),
              minimumRemainingDays: input.minimumRemainingDays ?? null,
              name,
              serialControl: input.serialControl ?? existing.serialControl,
              shelfLifeDays: input.shelfLifeDays ?? null,
              temperatureZone:
                input.temperatureZone ?? existing.temperatureZone,
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: { id: existing.id },
          });
          await this.record(
            transaction,
            'Product',
            product.id,
            product.version,
            'mdm.product-updated.v1',
            'product.update',
            context,
            metadata,
            { name: product.name, status: product.status },
            { name: existing.name, status: existing.status },
          );
          return {
            productId: product.id,
            status: product.status,
            version: product.version,
          };
        },
      )
      .catch((error: unknown) => {
        throw this.mapUnique(
          error,
          'PRODUCT_SKU_CONFLICT',
          'Product SKU already exists',
        );
      });
  }

  publishProduct(
    productId: string,
    input: VersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.validateId(productId, 'PRODUCT_NOT_FOUND');
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { productId, ...input },
        responseCode: 200,
        scope: 'mdm.product.publish.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const product = await transaction.product.findFirst({
          where: { id: productId, tenantId: context.tenantId },
        });
        if (!product)
          throw new AppError('PRODUCT_NOT_FOUND', 'Product was not found', 404);
        this.expected(
          product.version,
          input.expectedVersion,
          'PRODUCT_VERSION_CONFLICT',
        );
        if (product.status === 'INACTIVE')
          throw new AppError(
            'PRODUCT_INACTIVE',
            'Inactive product cannot be published',
            409,
          );
        if (product.status === 'DRAFT')
          assertProductTransition(product.status, 'ACTIVE');
        const specs = await transaction.packageSpec.findMany({
          orderBy: [{ code: 'asc' }, { versionNumber: 'asc' }],
          where: {
            productId,
            status: { in: ['DRAFT', 'PUBLISHED'] },
            tenantId: context.tenantId,
          },
        });
        if (
          !specs.some(
            (spec) =>
              spec.level === 'EACH' &&
              spec.quantityInBase.equals(1) &&
              spec.baseUom === product.baseUom,
          )
        )
          throw new AppError(
            'PRODUCT_BASE_PACKAGE_REQUIRED',
            'An EACH package with quantity 1 in the product base UOM is required',
            409,
          );
        const now = new Date();
        await transaction.packageSpec.updateMany({
          data: {
            publishedAt: now,
            status: 'PUBLISHED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { productId, status: 'DRAFT', tenantId: context.tenantId },
        });
        const publishedSpecs = await transaction.packageSpec.findMany({
          orderBy: [{ code: 'asc' }, { versionNumber: 'asc' }],
          where: { productId, status: 'PUBLISHED', tenantId: context.tenantId },
        });
        const barcodes = await transaction.productBarcode.findMany({
          orderBy: { barcode: 'asc' },
          where: { productId, status: 'ACTIVE', tenantId: context.tenantId },
        });
        const versionNumber = product.currentVersionNumber + 1;
        const snapshot = this.snapshot(product, publishedSpecs, barcodes);
        const changed = await transaction.product.update({
          data: {
            currentVersionNumber: versionNumber,
            status: product.status === 'DRAFT' ? 'ACTIVE' : product.status,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: product.id },
        });
        await transaction.productVersion.create({
          data: {
            createdBy: context.accountId,
            id: randomUUID(),
            productId,
            sku: product.sku,
            snapshot,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            versionNumber,
          },
        });
        await this.record(
          transaction,
          'Product',
          changed.id,
          changed.version,
          'mdm.product-published.v1',
          'product.publish',
          context,
          metadata,
          { productVersion: versionNumber, status: changed.status },
          {
            productVersion: product.currentVersionNumber,
            status: product.status,
          },
        );
        return {
          productId: changed.id,
          productVersion: versionNumber,
          status: changed.status,
          version: changed.version,
        };
      },
    );
  }

  deactivateProduct(
    productId: string,
    input: VersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.validateId(productId, 'PRODUCT_NOT_FOUND');
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { productId, ...input },
        responseCode: 200,
        scope: 'mdm.product.deactivate.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const product = await transaction.product.findFirst({
          where: { id: productId, tenantId: context.tenantId },
        });
        if (!product)
          throw new AppError('PRODUCT_NOT_FOUND', 'Product was not found', 404);
        this.expected(
          product.version,
          input.expectedVersion,
          'PRODUCT_VERSION_CONFLICT',
        );
        assertProductTransition(product.status, 'INACTIVE');
        const changed = await transaction.product.update({
          data: {
            status: 'INACTIVE',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: product.id },
        });
        await this.record(
          transaction,
          'Product',
          changed.id,
          changed.version,
          'mdm.product-inactivated.v1',
          'product.inactivate',
          context,
          metadata,
          { status: changed.status },
          { status: product.status },
        );
        return {
          productId: changed.id,
          status: changed.status,
          version: changed.version,
        };
      },
    );
  }

  savePackageSpec(
    input: SavePackageSpecInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.validateId(input.productId, 'PRODUCT_NOT_FOUND');
    const code = required(input.code, 'code', 100).toUpperCase();
    const name = required(input.name, 'name', 200);
    const originalUom = required(
      input.originalUom,
      'originalUom',
      20,
    ).toUpperCase();
    const baseUom = required(input.baseUom, 'baseUom', 20).toUpperCase();
    const quantityInBase = decimal(
      input.quantityInBase,
      'quantityInBase',
      false,
    )!;
    if (
      !CODE.test(code) ||
      !UOM.test(originalUom) ||
      !UOM.test(baseUom) ||
      (input.customerId !== undefined && !isUuid(input.customerId)) ||
      (input.parentSpecId !== undefined && !isUuid(input.parentSpecId))
    )
      throw new AppError(
        'PACKAGE_SPEC_INVALID',
        'Package specification input is invalid',
        400,
      );
    const measures = {
      grossWeight: decimal(input.grossWeight, 'grossWeight'),
      height: decimal(input.height, 'height'),
      length: decimal(input.length, 'length'),
      netWeight: decimal(input.netWeight, 'netWeight'),
      volume: decimal(input.volume, 'volume'),
      width: decimal(input.width, 'width'),
    };
    if (
      (measures.grossWeight || measures.netWeight) &&
      !input.weightUom?.trim()
    )
      throw new AppError(
        'PACKAGE_SPEC_WEIGHT_UOM_REQUIRED',
        'weightUom is required for weight values',
        400,
      );
    if (
      (measures.length || measures.width || measures.height) &&
      !input.dimensionUom?.trim()
    )
      throw new AppError(
        'PACKAGE_SPEC_DIMENSION_UOM_REQUIRED',
        'dimensionUom is required for dimensions',
        400,
      );
    if (measures.volume && !input.volumeUom?.trim())
      throw new AppError(
        'PACKAGE_SPEC_VOLUME_UOM_REQUIRED',
        'volumeUom is required for volume',
        400,
      );
    return this.idempotency
      .execute(
        {
          actorId: context.accountId,
          key: metadata.idempotencyKey,
          payload: input,
          responseCode: 201,
          scope: 'mdm.package-spec.create.v1',
          tenantId: context.tenantId,
        },
        async (transaction) => {
          const product = await transaction.product.findFirst({
            where: { id: input.productId, tenantId: context.tenantId },
          });
          if (!product)
            throw new AppError(
              'PRODUCT_NOT_FOUND',
              'Product was not found',
              404,
            );
          if (product.status === 'INACTIVE')
            throw new AppError(
              'PRODUCT_INACTIVE',
              'Inactive product cannot receive package specifications',
              409,
            );
          if (product.baseUom !== baseUom)
            throw new AppError(
              'PACKAGE_SPEC_BASE_UOM_MISMATCH',
              'Package base UOM must match product base UOM',
              409,
            );
          const parent = input.parentSpecId
            ? await transaction.packageSpec.findFirst({
                where: {
                  id: input.parentSpecId,
                  productId: input.productId,
                  status: { not: 'RETIRED' },
                  tenantId: context.tenantId,
                },
              })
            : null;
          if (input.parentSpecId && !parent)
            throw new AppError(
              'PACKAGE_SPEC_PARENT_NOT_FOUND',
              'Package parent was not found for this product',
              404,
            );
          const latest = await transaction.packageSpec.findFirst({
            orderBy: { versionNumber: 'desc' },
            where: {
              code,
              productId: input.productId,
              tenantId: context.tenantId,
            },
          });
          const spec = await transaction.packageSpec.create({
            data: {
              baseUom,
              code,
              createdBy: context.accountId,
              customerId: input.customerId ?? null,
              dimensionUom: input.dimensionUom?.trim().toUpperCase() ?? null,
              grossWeight: measures.grossWeight ?? null,
              height: measures.height ?? null,
              id: randomUUID(),
              length: measures.length ?? null,
              level: input.level,
              name,
              netWeight: measures.netWeight ?? null,
              originalUom,
              parentSpecId: parent?.id ?? null,
              productId: input.productId,
              quantityInBase,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
              versionNumber: (latest?.versionNumber ?? 0) + 1,
              volume: measures.volume ?? null,
              volumeUom: input.volumeUom?.trim().toUpperCase() ?? null,
              weightUom: input.weightUom?.trim().toUpperCase() ?? null,
              width: measures.width ?? null,
            },
          });
          await this.record(
            transaction,
            'PackageSpec',
            spec.id,
            spec.version,
            'mdm.package-spec-created.v1',
            'package-spec.create',
            context,
            metadata,
            {
              code: spec.code,
              status: spec.status,
              versionNumber: spec.versionNumber,
            },
          );
          return {
            packageSpecId: spec.id,
            status: spec.status,
            version: spec.version,
            versionNumber: spec.versionNumber,
          };
        },
      )
      .catch((error: unknown) => {
        throw this.mapUnique(
          error,
          'PACKAGE_SPEC_VERSION_CONFLICT',
          'Package specification version already exists',
        );
      });
  }

  retirePackageSpec(
    specId: string,
    input: VersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.validateId(specId, 'PACKAGE_SPEC_NOT_FOUND');
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { specId, ...input },
        responseCode: 200,
        scope: 'mdm.package-spec.retire.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const spec = await transaction.packageSpec.findFirst({
          where: { id: specId, tenantId: context.tenantId },
        });
        if (!spec)
          throw new AppError(
            'PACKAGE_SPEC_NOT_FOUND',
            'Package specification was not found',
            404,
          );
        this.expected(
          spec.version,
          input.expectedVersion,
          'PACKAGE_SPEC_VERSION_CONFLICT',
        );
        assertPackageSpecTransition(spec.status, 'RETIRED');
        const changed = await transaction.packageSpec.update({
          data: {
            status: 'RETIRED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: spec.id },
        });
        await this.record(
          transaction,
          'PackageSpec',
          changed.id,
          changed.version,
          'mdm.package-spec-retired.v1',
          'package-spec.retire',
          context,
          metadata,
          { status: changed.status },
          { status: spec.status },
        );
        return {
          packageSpecId: changed.id,
          status: changed.status,
          version: changed.version,
        };
      },
    );
  }

  async convert(
    specId: string,
    input: ConvertPackageQuantityInput,
    context: TenantContext,
  ) {
    this.validateId(specId, 'PACKAGE_SPEC_NOT_FOUND');
    const amount = decimal(input.amount, 'amount', false)!;
    const spec = await this.prisma.packageSpec.findFirst({
      where: {
        id: specId,
        status: { in: ['PUBLISHED', 'RETIRED'] },
        tenantId: context.tenantId,
      },
    });
    if (!spec)
      throw new AppError(
        'PACKAGE_SPEC_NOT_PUBLISHED',
        'Published package specification was not found',
        404,
      );
    return {
      baseAmount: amount.mul(spec.quantityInBase).toFixed(),
      baseUom: spec.baseUom,
      originalAmount: amount.toFixed(),
      originalUom: spec.originalUom,
      packageSpecId: spec.id,
      packageSpecVersion: spec.versionNumber,
      productId: spec.productId,
    };
  }

  addBarcode(
    input: AddBarcodeInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.validateId(input.productId, 'PRODUCT_NOT_FOUND');
    const barcode = required(input.barcode, 'barcode', 200);
    if (
      (input.packageSpecId !== undefined && !isUuid(input.packageSpecId)) ||
      (input.customerId !== undefined && !isUuid(input.customerId)) ||
      (input.type === 'CUSTOMER') !== Boolean(input.customerId)
    )
      throw new AppError(
        'PRODUCT_BARCODE_INVALID',
        'Customer barcodes require a customerId and other barcode types must be global',
        400,
      );
    return this.idempotency
      .execute(
        {
          actorId: context.accountId,
          key: metadata.idempotencyKey,
          payload: input,
          responseCode: 201,
          scope: 'mdm.product-barcode.create.v1',
          tenantId: context.tenantId,
        },
        async (transaction) => {
          const product = await transaction.product.findFirst({
            where: { id: input.productId, tenantId: context.tenantId },
          });
          if (!product)
            throw new AppError(
              'PRODUCT_NOT_FOUND',
              'Product was not found',
              404,
            );
          if (product.status === 'INACTIVE')
            throw new AppError(
              'PRODUCT_INACTIVE',
              'Inactive product cannot receive barcodes',
              409,
            );
          const spec = input.packageSpecId
            ? await transaction.packageSpec.findFirst({
                where: {
                  id: input.packageSpecId,
                  productId: input.productId,
                  status: { not: 'RETIRED' },
                  tenantId: context.tenantId,
                },
              })
            : null;
          if (input.packageSpecId && !spec)
            throw new AppError(
              'PACKAGE_SPEC_NOT_FOUND',
              'Package specification was not found for this product',
              404,
            );
          const productBarcode = await transaction.productBarcode.create({
            data: {
              barcode,
              createdBy: context.accountId,
              customerId: input.customerId ?? null,
              id: randomUUID(),
              isPrimary: input.isPrimary ?? false,
              packageSpecId: spec?.id ?? null,
              productId: product.id,
              tenantId: context.tenantId,
              type: input.type,
              updatedBy: context.accountId,
            },
          });
          await this.record(
            transaction,
            'ProductBarcode',
            productBarcode.id,
            productBarcode.version,
            'mdm.product-barcode-created.v1',
            'product-barcode.create',
            context,
            metadata,
            { barcode, status: productBarcode.status },
          );
          return {
            barcodeId: productBarcode.id,
            status: productBarcode.status,
            version: productBarcode.version,
          };
        },
      )
      .catch((error: unknown) => {
        throw this.mapUnique(
          error,
          'PRODUCT_BARCODE_CONFLICT',
          'Barcode already exists in this tenant and customer scope',
        );
      });
  }

  deactivateBarcode(
    barcodeId: string,
    input: VersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.validateId(barcodeId, 'PRODUCT_BARCODE_NOT_FOUND');
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { barcodeId, ...input },
        responseCode: 200,
        scope: 'mdm.product-barcode.deactivate.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const barcode = await transaction.productBarcode.findFirst({
          where: { id: barcodeId, tenantId: context.tenantId },
        });
        if (!barcode)
          throw new AppError(
            'PRODUCT_BARCODE_NOT_FOUND',
            'Product barcode was not found',
            404,
          );
        this.expected(
          barcode.version,
          input.expectedVersion,
          'PRODUCT_BARCODE_VERSION_CONFLICT',
        );
        assertBarcodeTransition(barcode.status, 'INACTIVE');
        const changed = await transaction.productBarcode.update({
          data: {
            status: 'INACTIVE',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: barcode.id },
        });
        await this.record(
          transaction,
          'ProductBarcode',
          changed.id,
          changed.version,
          'mdm.product-barcode-inactivated.v1',
          'product-barcode.inactivate',
          context,
          metadata,
          { status: changed.status },
          { status: barcode.status },
        );
        return {
          barcodeId: changed.id,
          status: changed.status,
          version: changed.version,
        };
      },
    );
  }

  async resolveBarcode(
    barcodeInput: string,
    customerId: string | undefined,
    context: TenantContext,
  ) {
    const barcode = required(barcodeInput, 'barcode', 200);
    if (customerId !== undefined && !isUuid(customerId))
      throw new AppError(
        'PRODUCT_BARCODE_INVALID',
        'customerId is invalid',
        400,
      );
    const match = customerId
      ? await this.prisma.productBarcode.findFirst({
          orderBy: { customerId: { sort: 'desc', nulls: 'last' } },
          where: {
            barcode,
            OR: [{ customerId }, { customerId: null }],
            status: 'ACTIVE',
            tenantId: context.tenantId,
          },
        })
      : await this.prisma.productBarcode.findFirst({
          where: {
            barcode,
            customerId: null,
            status: 'ACTIVE',
            tenantId: context.tenantId,
          },
        });
    if (!match)
      throw new AppError(
        'PRODUCT_BARCODE_NOT_FOUND',
        'Active product barcode was not found',
        404,
      );
    const product = await this.prisma.product.findFirst({
      where: { id: match.productId, tenantId: context.tenantId },
    });
    if (!product)
      throw new AppError('PRODUCT_NOT_FOUND', 'Product was not found', 404);
    const packageSpec = match.packageSpecId
      ? await this.prisma.packageSpec.findFirst({
          where: { id: match.packageSpecId, tenantId: context.tenantId },
        })
      : null;
    return { barcode: match, packageSpec, product };
  }

  private snapshot(
    product: {
      baseUom: string;
      batchControl: string;
      categoryId: string | null;
      categorySnapshot: Prisma.JsonValue;
      hazardous: boolean;
      hazardousAttributes: Prisma.JsonValue;
      id: string;
      minimumRemainingDays: number | null;
      name: string;
      serialControl: string;
      shelfLifeDays: number | null;
      sku: string;
      temperatureZone: string;
    },
    specs: readonly {
      baseUom: string;
      code: string;
      customerId: string | null;
      id: string;
      level: string;
      name: string;
      originalUom: string;
      quantityInBase: Prisma.Decimal;
      versionNumber: number;
    }[],
    barcodes: readonly {
      barcode: string;
      customerId: string | null;
      id: string;
      isPrimary: boolean;
      packageSpecId: string | null;
      type: string;
    }[],
  ): Prisma.InputJsonObject {
    return {
      barcodes: barcodes.map((item) => ({
        barcode: item.barcode,
        customerId: item.customerId,
        id: item.id,
        isPrimary: item.isPrimary,
        packageSpecId: item.packageSpecId,
        type: item.type,
      })),
      baseUom: product.baseUom,
      batchControl: product.batchControl,
      categoryId: product.categoryId,
      categorySnapshot: product.categorySnapshot,
      hazardous: product.hazardous,
      hazardousAttributes: product.hazardousAttributes,
      minimumRemainingDays: product.minimumRemainingDays,
      name: product.name,
      packageSpecs: specs.map((item) => ({
        baseUom: item.baseUom,
        code: item.code,
        customerId: item.customerId,
        id: item.id,
        level: item.level,
        name: item.name,
        originalUom: item.originalUom,
        quantityInBase: item.quantityInBase.toFixed(),
        versionNumber: item.versionNumber,
      })),
      productId: product.id,
      serialControl: product.serialControl,
      shelfLifeDays: product.shelfLifeDays,
      sku: product.sku,
      temperatureZone: product.temperatureZone,
    } as Prisma.InputJsonObject;
  }

  private async record(
    transaction: Prisma.TransactionClient,
    aggregateType: string,
    aggregateId: string,
    aggregateVersion: number,
    eventName: string,
    action: string,
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
          category: 'BUSINESS_CHANGE',
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          deviceId: context.deviceId,
          ipAddress: metadata.ipAddress ?? null,
          resourceId: aggregateId,
          resourceType: aggregateType,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      transaction.platformOutbox.create({
        data: {
          aggregateId,
          aggregateType,
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

  private validateId(id: string, code: string) {
    if (!isUuid(id)) throw new AppError(code, 'Resource was not found', 404);
  }
  private expected(actual: number, expected: number | undefined, code: string) {
    if (!Number.isInteger(expected) || actual !== expected)
      throw new AppError(code, 'Resource changed; refresh and retry', 409, {
        retryable: true,
      });
  }
  private mapUnique(error: unknown, code: string, message: string): unknown {
    return isPrismaErrorCode(error, 'P2002')
      ? new AppError(code, message, 409)
      : error;
  }
}
