import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  AttachmentService,
  type CompleteUploadInput,
  type CreateAttachmentLinkInput,
  type CreateUploadInput,
  type IssueDownloadInput,
  type ListAttachmentQuery,
  type RecordScanInput,
} from './attachment.service';
import type { TenantRequest } from './auth/tenant-context.middleware';
import { RequirePermission } from './auth/permission.decorator';
import { PermissionGuard } from './auth/permission.guard';

@Controller('api/v1/platform/attachments')
@UseGuards(PermissionGuard)
export class AttachmentController {
  constructor(
    @Inject(AttachmentService)
    private readonly attachments: AttachmentService,
  ) {}

  @Get()
  @RequirePermission('platform.attachment.read')
  list(@Query() query: ListAttachmentQuery, @Req() request: TenantRequest) {
    return this.attachments.list(request.tenantContext, query);
  }

  @Post('uploads')
  @RequirePermission('platform.attachment.write')
  createUpload(
    @Body() input: CreateUploadInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.attachments.createUpload(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post(':fileObjectId/uploads/complete')
  @RequirePermission('platform.attachment.write')
  completeUpload(
    @Param('fileObjectId') fileObjectId: string,
    @Body() input: CompleteUploadInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.attachments.completeUpload(
      fileObjectId,
      input,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }

  @Post(':fileObjectId/scan-results')
  @RequirePermission('platform.attachment.scan')
  recordScan(
    @Param('fileObjectId') fileObjectId: string,
    @Body() input: RecordScanInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.attachments.recordScan(
      fileObjectId,
      input,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }

  @Post(':fileObjectId/links')
  @RequirePermission('platform.attachment.write')
  createLink(
    @Param('fileObjectId') fileObjectId: string,
    @Body() input: CreateAttachmentLinkInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.attachments.createLink(
      fileObjectId,
      input,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }

  @Post(':fileObjectId/downloads')
  @RequirePermission('platform.attachment.download')
  issueDownload(
    @Param('fileObjectId') fileObjectId: string,
    @Body() input: IssueDownloadInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.attachments.issueDownload(
      fileObjectId,
      input,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }

  @Get('downloads/:token')
  @RequirePermission('platform.attachment.download')
  async consumeDownload(
    @Param('token') token: string,
    @Req() request: TenantRequest,
    @Res() response: Response,
  ) {
    const result = await this.attachments.consumeDownload(
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
}
