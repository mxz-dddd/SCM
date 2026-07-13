import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { TenantRequest } from './auth/tenant-context.middleware';
import {
  WorkspaceService,
  type SavePageSessionInput,
  type SaveWorkspaceInput,
  type ToggleFavoriteInput,
} from './workspace.service';

@Controller('api/v1/platform/workspace')
export class WorkspaceController {
  constructor(
    @Inject(WorkspaceService) private readonly workspace: WorkspaceService,
  ) {}

  @Get()
  get(@Req() request: TenantRequest) {
    return this.workspace.get(request.tenantContext);
  }

  @Put()
  @HttpCode(200)
  saveLayout(
    @Body() input: SaveWorkspaceInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.workspace.saveLayout(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Put('page-sessions')
  @HttpCode(200)
  savePage(
    @Body() input: SavePageSessionInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.workspace.savePage(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('favorites/toggle')
  @HttpCode(200)
  toggleFavorite(
    @Body() input: ToggleFavoriteInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.workspace.toggleFavorite(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }
}
