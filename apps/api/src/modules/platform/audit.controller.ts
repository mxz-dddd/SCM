import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { TenantRequest } from './auth/tenant-context.middleware';
import { RequirePermission } from './auth/permission.decorator';
import { PermissionGuard } from './auth/permission.guard';
import {
  AuditService,
  type AuditListQuery,
  type ChangeHistoryQuery,
  type RecordExportInput,
} from './audit.service';

@Controller('api/v1/platform/audit')
@UseGuards(PermissionGuard)
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get('logs')
  @RequirePermission('platform.audit.read')
  listLogs(
    @Query() query: AuditListQuery,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.audit.listAuditLogs(query, request.tenantContext, {
      correlationId,
      ipAddress: request.ip,
    });
  }

  @Get('change-history')
  @RequirePermission('platform.audit.read')
  listChangeHistory(
    @Query() query: ChangeHistoryQuery,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.audit.listChangeHistory(query, request.tenantContext, {
      correlationId,
      ipAddress: request.ip,
    });
  }

  @Post('exports')
  @RequirePermission('platform.audit.export')
  recordExport(
    @Body() input: RecordExportInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.audit.recordExport(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }
}
