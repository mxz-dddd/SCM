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

  async resolveOrderReferences(input: OrderReferenceRequest, context: TenantContext) {
    const productIds = [...new Set(input.lines.flatMap(({ productId }) => (productId ? [productId] : [])))];
    const packageSpecIds = [...new Set(input.lines.flatMap(({ packageSpecId }) => (packageSpecId ? [packageSpecId] : [])))];
    const [customer, address, products, packageSpecs] = await Promise.all([
      input.customerId
        ? this.prisma.partner.findFirst({
            where: { id: input.customerId, status: 'ACTIVE', tenantId: context.tenantId },
          })
        : null,
      input.addressId
        ? this.prisma.partnerAddress.findFirst({
            where: { id: input.addressId, status: 'ACTIVE', tenantId: context.tenantId },
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
        ? { code: customer.code, id: customer.id, legalName: customer.legalName }
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
        hazardous: product.hazardous,
        id: product.id,
        name: product.name,
        sku: product.sku,
        versionNumber: product.currentVersionNumber,
        versionSnapshot:
          versions.find(
            ({ productId, versionNumber }) =>
              productId === product.id && versionNumber === product.currentVersionNumber,
          )?.snapshot ?? {},
      })),
    };
  }
}
