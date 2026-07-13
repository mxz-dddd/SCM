import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { TenantRequest } from './auth/tenant-context.middleware';
import { RequirePermission } from './auth/permission.decorator';
import { PermissionGuard } from './auth/permission.guard';
import {
  ExportService,
  type CreateExportInput,
  type ExportVersionInput,
  type FailExportInput,
} from './export.service';
import {
  ImportService,
  type CompleteImportInput,
  type CreateImportInput,
  type VersionInput,
} from './import.service';
import {
  SearchService,
  type ChangeSavedViewStatusInput,
  type IndexSearchDocumentInput,
  type SaveViewInput,
  type SearchInput,
} from './search.service';

@Controller('api/v1/platform')
@UseGuards(PermissionGuard)
export class DataExchangeController {
  constructor(
    @Inject(ExportService) private readonly exports: ExportService,
    @Inject(ImportService) private readonly imports: ImportService,
    @Inject(SearchService) private readonly searchService: SearchService,
  ) {}

  @Get('imports')
  @RequirePermission('platform.import.read')
  listImports(@Req() request: TenantRequest) {
    return this.imports.list(request.tenantContext);
  }

  @Get('imports/:importJobId/errors')
  @RequirePermission('platform.import.read')
  listImportErrors(
    @Param('importJobId') importJobId: string,
    @Req() request: TenantRequest,
  ) {
    return this.imports.listErrors(importJobId, request.tenantContext);
  }

  @Post('imports')
  @RequirePermission('platform.import.write')
  createImport(
    @Body() input: CreateImportInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.imports.create(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('imports/:importJobId/validation')
  @HttpCode(202)
  @RequirePermission('platform.import.write')
  startValidation(
    @Param('importJobId') importJobId: string,
    @Body() input: VersionInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.imports.transition(
      importJobId,
      'VALIDATING',
      input,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }

  @Post('imports/:importJobId/validation-result')
  @RequirePermission('platform.import.process')
  processValidation(
    @Param('importJobId') importJobId: string,
    @Body() input: VersionInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.imports.processValidation(
      importJobId,
      input,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }

  @Post('imports/:importJobId/execution')
  @HttpCode(202)
  @RequirePermission('platform.import.write')
  startImport(
    @Param('importJobId') importJobId: string,
    @Body() input: VersionInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.imports.transition(
      importJobId,
      'IMPORTING',
      input,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }

  @Post('imports/:importJobId/result')
  @RequirePermission('platform.import.process')
  completeImport(
    @Param('importJobId') importJobId: string,
    @Body() input: CompleteImportInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.imports.complete(importJobId, input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Get('exports')
  @RequirePermission('platform.export.read')
  listExports(@Req() request: TenantRequest) {
    return this.exports.list(request.tenantContext);
  }

  @Post('exports')
  @HttpCode(202)
  @RequirePermission('platform.export.create')
  createExport(
    @Body() input: CreateExportInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.exports.create(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('exports/:exportJobId/start')
  @HttpCode(202)
  @RequirePermission('platform.export.process')
  startExport(
    @Param('exportJobId') exportJobId: string,
    @Body() input: ExportVersionInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.exports.start(exportJobId, input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('exports/:exportJobId/process')
  @RequirePermission('platform.export.process')
  processExport(
    @Param('exportJobId') exportJobId: string,
    @Body() input: ExportVersionInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.exports.process(exportJobId, input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('exports/:exportJobId/failure')
  @RequirePermission('platform.export.process')
  failExport(
    @Param('exportJobId') exportJobId: string,
    @Body() input: FailExportInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.exports.fail(exportJobId, input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('exports/:exportJobId/downloads')
  @RequirePermission('platform.export.download')
  issueExportDownload(
    @Param('exportJobId') exportJobId: string,
    @Body() input: ExportVersionInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.exports.issueDownload(
      exportJobId,
      input,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }

  @Get('exports/downloads/:token')
  @RequirePermission('platform.export.download')
  async consumeExportDownload(
    @Param('token') token: string,
    @Req() request: TenantRequest,
    @Res() response: Response,
  ) {
    const result = await this.exports.consumeDownload(
      token,
      request.tenantContext,
    );
    response.setHeader('Content-Type', result.contentType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(result.body);
  }

  @Get('search')
  @RequirePermission('platform.search.read')
  search(
    @Query() input: SearchInput,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.searchService.search(input, request.tenantContext, {
      correlationId,
      ipAddress: request.ip,
    });
  }

  @Post('search/documents')
  @RequirePermission('platform.search.index')
  indexSearchDocument(
    @Body() input: IndexSearchDocumentInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.searchService.index(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Get('saved-views')
  @RequirePermission('platform.saved-view.read')
  listSavedViews(
    @Query('resourceType') resourceType: string,
    @Req() request: TenantRequest,
  ) {
    return this.searchService.listSavedViews(
      resourceType,
      request.tenantContext,
    );
  }

  @Post('saved-views')
  @RequirePermission('platform.saved-view.write')
  saveView(
    @Body() input: SaveViewInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.searchService.saveView(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('saved-views/:savedViewId/status')
  @RequirePermission('platform.saved-view.write')
  changeSavedViewStatus(
    @Param('savedViewId') savedViewId: string,
    @Body() input: ChangeSavedViewStatusInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.searchService.changeViewStatus(
      savedViewId,
      input,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }
}
