import { Inject, Injectable } from '@nestjs/common';
import type { TenantContext } from '@scm/shared';
import { PrismaService } from '../../../database/prisma.service';

export interface OrderReferenceRequest {
  readonly addressId?: string;
  readonly customerId?: string;
  readonly lines: readonly {
    readonly packageSpecId?: string;
    readonly productId?: string;
  }[];
}

@Injectable()
export class MdmReferenceService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async resolveOrderReferences(
    input: OrderReferenceRequest,
    context: TenantContext,
  ) {
    const productIds = [
      ...new Set(
        input.lines.flatMap(({ productId }) => (productId ? [productId] : [])),
      ),
    ];
    const packageSpecIds = [
      ...new Set(
        input.lines.flatMap(({ packageSpecId }) =>
          packageSpecId ? [packageSpecId] : [],
        ),
      ),
    ];
    const [customer, address, products, packageSpecs] = await Promise.all([
      input.customerId
        ? this.prisma.partner.findFirst({
            where: {
              id: input.customerId,
              status: 'ACTIVE',
              tenantId: context.tenantId,
            },
          })
        : null,
      input.addressId
        ? this.prisma.partnerAddress.findFirst({
            where: {
              id: input.addressId,
              status: 'ACTIVE',
              tenantId: context.tenantId,
            },
          })
        : null,
      this.prisma.product.findMany({
        where: {
          currentVersionNumber: { gt: 0 },
          id: { in: productIds },
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      }),
      this.prisma.packageSpec.findMany({
        where: {
          id: { in: packageSpecIds },
          status: 'PUBLISHED',
          tenantId: context.tenantId,
        },
      }),
    ]);
    const versions = await this.prisma.productVersion.findMany({
      where: {
        OR: products.map(({ currentVersionNumber, id }) => ({
          productId: id,
          versionNumber: currentVersionNumber,
        })),
        tenantId: context.tenantId,
      },
    });
    return {
      address: address
        ? {
            code: address.code,
            countryCode: address.countryCode,
            geocodeStatus: address.geocodeStatus,
            id: address.id,
            partnerId: address.partnerId,
            rawText: address.rawText,
          }
        : null,
      customer: customer
        ? {
            code: customer.code,
            id: customer.id,
            legalName: customer.legalName,
          }
        : null,
      packageSpecs: packageSpecs.map((specification) => ({
        baseUom: specification.baseUom,
        code: specification.code,
        id: specification.id,
        originalUom: specification.originalUom,
        productId: specification.productId,
        quantityInBase: specification.quantityInBase.toString(),
        versionNumber: specification.versionNumber,
      })),
      products: products.map((product) => ({
        baseUom: product.baseUom,
        batchControl: product.batchControl,
        hazardous: product.hazardous,
        id: product.id,
        minimumRemainingDays: product.minimumRemainingDays,
        name: product.name,
        serialControl: product.serialControl,
        shelfLifeDays: product.shelfLifeDays,
        sku: product.sku,
        temperatureZone: product.temperatureZone,
        versionNumber: product.currentVersionNumber,
        versionSnapshot:
          versions.find(
            ({ productId, versionNumber }) =>
              productId === product.id &&
              versionNumber === product.currentVersionNumber,
          )?.snapshot ?? {},
      })),
    };
  }

  async resolveBarcode(
    barcode: string,
    customerId: string | undefined,
    context: TenantContext,
  ) {
    const candidates = await this.prisma.productBarcode.findMany({
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      where: {
        barcode,
        ...(customerId
          ? { OR: [{ customerId }, { customerId: null }] }
          : { customerId: null }),
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    const match =
      candidates.find(({ customerId: scope }) => scope === customerId) ??
      candidates[0];
    if (!match) return null;
    const [product, packageSpec] = await Promise.all([
      this.prisma.product.findFirst({
        where: {
          id: match.productId,
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      }),
      match.packageSpecId
        ? this.prisma.packageSpec.findFirst({
            where: {
              id: match.packageSpecId,
              status: 'PUBLISHED',
              tenantId: context.tenantId,
            },
          })
        : null,
    ]);
    if (!product) return null;
    return {
      barcodeId: match.id,
      barcodeType: match.type,
      packageSpec: packageSpec
        ? {
            baseUom: packageSpec.baseUom,
            id: packageSpec.id,
            originalUom: packageSpec.originalUom,
            quantityInBase: packageSpec.quantityInBase.toString(),
            versionNumber: packageSpec.versionNumber,
          }
        : null,
      product: {
        baseUom: product.baseUom,
        id: product.id,
        name: product.name,
        sku: product.sku,
        versionNumber: product.currentVersionNumber,
      },
      scope: match.customerId ? 'CUSTOMER' : 'TENANT',
    };
  }

  async scanObjectExists(
    objectType: 'PRODUCT' | 'LOCATION',
    objectId: string,
    context: TenantContext,
  ) {
    if (objectType === 'PRODUCT') {
      return (
        (await this.prisma.product.count({
          where: {
            id: objectId,
            status: 'ACTIVE',
            tenantId: context.tenantId,
          },
        })) === 1
      );
    }
    return (
      (await this.prisma.warehouseLocation.count({
        where: {
          id: objectId,
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      })) === 1
    );
  }

  async listWarehouseLocations(warehouseId: string, context: TenantContext) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: {
        id: warehouseId,
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    if (!warehouse) return [];
    const locations = await this.prisma.warehouseLocation.findMany({
      orderBy: [{ sequence: 'asc' }, { code: 'asc' }],
      where: {
        status: 'ACTIVE',
        tenantId: context.tenantId,
        warehouseId,
      },
    });
    return locations.map((location) => ({
      code: location.code,
      hazardousAllowed: location.hazardousAllowed,
      id: location.id,
      maxVolume: location.maxVolume?.toString() ?? null,
      maxWeight: location.maxWeight?.toString() ?? null,
      mixingRules: location.mixingRules,
      name: location.name,
      palletCapacity: location.palletCapacity?.toString() ?? null,
      parentId: location.parentId,
      sequence: location.sequence,
      temperatureZone: location.temperatureZone,
      type: location.type,
      warehouseId,
    }));
  }
}
