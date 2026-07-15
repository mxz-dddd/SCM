import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { ProductStatus } from '@prisma/client';
import type { TenantRequest } from '../platform/auth/tenant-context.middleware';
import { RequirePermission } from '../platform/auth/permission.decorator';
import { PermissionGuard } from '../platform/auth/permission.guard';
import {
  ProductService,
  type AddBarcodeInput,
  type ConvertPackageQuantityInput,
  type SaveCategoryInput,
  type SavePackageSpecInput,
  type SaveProductInput,
  type VersionInput,
} from './product.service';

function metadata(
  request: TenantRequest,
  correlationId: string,
  idempotencyKey?: string,
) {
  return { correlationId, idempotencyKey, ipAddress: request.ip };
}

@Controller('api/v1/mdm')
@UseGuards(PermissionGuard)
export class ProductController {
  constructor(
    @Inject(ProductService) private readonly products: ProductService,
  ) {}

  @Get('categories')
  @RequirePermission('mdm.product.read')
  listCategories(@Req() request: TenantRequest) {
    return this.products.listCategories(request.tenantContext);
  }

  @Post('categories')
  @RequirePermission('mdm.product.write')
  createCategory(
    @Body() input: SaveCategoryInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.products.createCategory(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('categories/:categoryId/deactivate')
  @HttpCode(200)
  @RequirePermission('mdm.product.write')
  deactivateCategory(
    @Param('categoryId') categoryId: string,
    @Body() input: VersionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.products.deactivateCategory(
      categoryId,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Get('products')
  @RequirePermission('mdm.product.read')
  listProducts(
    @Query('status') status: ProductStatus | undefined,
    @Req() request: TenantRequest,
  ) {
    return this.products.listProducts(request.tenantContext, status);
  }

  @Get('products/:productId')
  @RequirePermission('mdm.product.read')
  getProduct(
    @Param('productId') productId: string,
    @Req() request: TenantRequest,
  ) {
    return this.products.getProduct(productId, request.tenantContext);
  }

  @Post('products')
  @RequirePermission('mdm.product.write')
  createProduct(
    @Body() input: SaveProductInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.products.saveProduct(
      undefined,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Put('products/:productId')
  @HttpCode(200)
  @RequirePermission('mdm.product.write')
  updateProduct(
    @Param('productId') productId: string,
    @Body() input: SaveProductInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.products.saveProduct(
      productId,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('products/:productId/publish')
  @HttpCode(200)
  @RequirePermission('mdm.product.publish')
  publishProduct(
    @Param('productId') productId: string,
    @Body() input: VersionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.products.publishProduct(
      productId,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('products/:productId/deactivate')
  @HttpCode(200)
  @RequirePermission('mdm.product.write')
  deactivateProduct(
    @Param('productId') productId: string,
    @Body() input: VersionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.products.deactivateProduct(
      productId,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('package-specs')
  @RequirePermission('mdm.product.write')
  savePackageSpec(
    @Body() input: SavePackageSpecInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.products.savePackageSpec(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('package-specs/:specId/retire')
  @HttpCode(200)
  @RequirePermission('mdm.product.write')
  retirePackageSpec(
    @Param('specId') specId: string,
    @Body() input: VersionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.products.retirePackageSpec(
      specId,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('package-specs/:specId/convert')
  @HttpCode(200)
  @RequirePermission('mdm.product.read')
  convert(
    @Param('specId') specId: string,
    @Body() input: ConvertPackageQuantityInput,
    @Req() request: TenantRequest,
  ) {
    return this.products.convert(specId, input, request.tenantContext);
  }

  @Post('barcodes')
  @RequirePermission('mdm.product.write')
  addBarcode(
    @Body() input: AddBarcodeInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.products.addBarcode(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('barcodes/:barcodeId/deactivate')
  @HttpCode(200)
  @RequirePermission('mdm.product.write')
  deactivateBarcode(
    @Param('barcodeId') barcodeId: string,
    @Body() input: VersionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.products.deactivateBarcode(
      barcodeId,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Get('barcodes/resolve')
  @RequirePermission('mdm.product.read')
  resolveBarcode(
    @Query('barcode') barcode: string,
    @Query('customerId') customerId: string | undefined,
    @Req() request: TenantRequest,
  ) {
    return this.products.resolveBarcode(
      barcode,
      customerId,
      request.tenantContext,
    );
  }
}
