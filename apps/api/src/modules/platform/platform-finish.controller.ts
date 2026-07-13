import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { TenantRequest } from './auth/tenant-context.middleware';
import { RequirePermission } from './auth/permission.decorator';
import { PermissionGuard } from './auth/permission.guard';
import { CollaborationPrintService, type ClaimPrintJobInput, type CompletePrintJobInput, type CreateCommentInput, type CreatePrintJobInput, type SavePrinterInput, type SavePrintTemplateInput, type VersionInput } from './collaboration-print.service';
import { FeatureFlagService, type EvaluateFlagInput, type FlagVersionInput, type SaveFeatureFlagInput } from './feature-flag.service';
import { LocaleUnitService, type ConvertQuantityInput, type LocalePreferenceInput, type UnitConversionInput } from './locale-unit.service';

function meta(request: TenantRequest, correlationId: string, idempotencyKey?: string) {
  return { correlationId, idempotencyKey, ipAddress: request.ip };
}

@Controller('api/v1/platform/finalization')
@UseGuards(PermissionGuard)
export class PlatformFinishController {
  constructor(
    @Inject(CollaborationPrintService) private readonly collaboration: CollaborationPrintService,
    @Inject(FeatureFlagService) private readonly flags: FeatureFlagService,
    @Inject(LocaleUnitService) private readonly locale: LocaleUnitService,
  ) {}

  @Get('locale') @RequirePermission('platform.locale.read')
  getLocale(@Req() request: TenantRequest) { return this.locale.getLocale(request.tenantContext); }

  @Post('locale') @HttpCode(200) @RequirePermission('platform.locale.write')
  saveLocale(@Body() input: LocalePreferenceInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') trace: string, @Req() request: TenantRequest) {
    return this.locale.saveLocale(input, request.tenantContext, meta(request, trace, key));
  }

  @Get('locale/format') @RequirePermission('platform.locale.read')
  formatInstant(@Query('instant') instant: string, @Req() request: TenantRequest) { return this.locale.formatInstant(instant, request.tenantContext); }

  @Get('unit-conversions') @RequirePermission('platform.unit.read')
  listConversions(@Req() request: TenantRequest) { return this.locale.listConversions(request.tenantContext); }

  @Post('unit-conversions') @RequirePermission('platform.unit.write')
  createConversion(@Body() input: UnitConversionInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') trace: string, @Req() request: TenantRequest) {
    return this.locale.createConversion(input, request.tenantContext, meta(request, trace, key));
  }

  @Post('unit-conversions/convert') @HttpCode(200) @RequirePermission('platform.unit.read')
  convert(@Body() input: ConvertQuantityInput, @Req() request: TenantRequest) { return this.locale.convert(input, request.tenantContext); }

  @Get('feature-flags') @RequirePermission('platform.feature.read')
  listFlags(@Req() request: TenantRequest) { return this.flags.list(request.tenantContext); }

  @Post('feature-flags') @RequirePermission('platform.feature.write')
  saveFlag(@Body() input: SaveFeatureFlagInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') trace: string, @Req() request: TenantRequest) {
    return this.flags.save(input, request.tenantContext, meta(request, trace, key));
  }

  @Post('feature-flags/evaluate') @HttpCode(200) @RequirePermission('platform.feature.evaluate')
  evaluateFlag(@Body() input: EvaluateFlagInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') trace: string, @Req() request: TenantRequest) {
    return this.flags.evaluate(input, request.tenantContext, meta(request, trace, key));
  }

  @Post('feature-flags/:flagId/:target') @HttpCode(200) @RequirePermission('platform.feature.write')
  changeFlag(@Param('flagId') flagId: string, @Param('target') target: string, @Body() input: FlagVersionInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') trace: string, @Req() request: TenantRequest) {
    if (!['PAUSED', 'PUBLISHED', 'RETIRED'].includes(target)) throw new Error('Unsupported feature flag target');
    return this.flags.changeStatus(flagId, target as 'PAUSED' | 'PUBLISHED' | 'RETIRED', input, request.tenantContext, meta(request, trace, key));
  }

  @Get('comments') @RequirePermission('platform.comment.read')
  listComments(@Query('businessType') businessType: string, @Query('businessId') businessId: string, @Req() request: TenantRequest) {
    return this.collaboration.listComments(businessType, businessId, false, request.tenantContext);
  }

  @Get('comments/external') @RequirePermission('platform.comment.external')
  listExternalComments(@Query('businessType') businessType: string, @Query('businessId') businessId: string, @Req() request: TenantRequest) {
    return this.collaboration.listComments(businessType, businessId, true, request.tenantContext);
  }

  @Post('comments') @RequirePermission('platform.comment.write')
  createComment(@Body() input: CreateCommentInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') trace: string, @Req() request: TenantRequest) {
    return this.collaboration.createComment(input, request.tenantContext, meta(request, trace, key));
  }

  @Post('comments/:commentId/:target') @HttpCode(200) @RequirePermission('platform.comment.write')
  changeComment(@Param('commentId') commentId: string, @Param('target') target: string, @Body() input: VersionInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') trace: string, @Req() request: TenantRequest) {
    if (!['OPEN', 'RESOLVED'].includes(target)) throw new Error('Unsupported comment target');
    return this.collaboration.changeCommentStatus(commentId, target as 'OPEN' | 'RESOLVED', input, request.tenantContext, meta(request, trace, key));
  }

  @Get('print-templates') @RequirePermission('platform.print.read')
  listTemplates(@Req() request: TenantRequest) { return this.collaboration.listTemplates(request.tenantContext); }

  @Post('print-templates') @RequirePermission('platform.print.write')
  saveTemplate(@Body() input: SavePrintTemplateInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') trace: string, @Req() request: TenantRequest) {
    return this.collaboration.saveTemplate(input, request.tenantContext, meta(request, trace, key));
  }

  @Post('print-templates/:templateId/:target') @HttpCode(200) @RequirePermission('platform.print.write')
  changeTemplate(@Param('templateId') templateId: string, @Param('target') target: string, @Body() input: VersionInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') trace: string, @Req() request: TenantRequest) {
    if (!['PUBLISHED', 'RETIRED'].includes(target)) throw new Error('Unsupported print template target');
    return this.collaboration.changeTemplateStatus(templateId, target as 'PUBLISHED' | 'RETIRED', input, request.tenantContext, meta(request, trace, key));
  }

  @Get('printers') @RequirePermission('platform.print.read')
  listPrinters(@Req() request: TenantRequest) { return this.collaboration.listPrinters(request.tenantContext); }

  @Post('printers') @RequirePermission('platform.print.write')
  savePrinter(@Body() input: SavePrinterInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') trace: string, @Req() request: TenantRequest) {
    return this.collaboration.savePrinter(input, request.tenantContext, meta(request, trace, key));
  }

  @Get('print-jobs') @RequirePermission('platform.print.read')
  listPrintJobs(@Req() request: TenantRequest) { return this.collaboration.listPrintJobs(request.tenantContext); }

  @Get('print-jobs/:jobId') @RequirePermission('platform.print.read')
  getPrintJob(@Param('jobId') jobId: string, @Req() request: TenantRequest) { return this.collaboration.getPrintJob(jobId, request.tenantContext); }

  @Post('print-jobs') @HttpCode(202) @RequirePermission('platform.print.create')
  createPrintJob(@Body() input: CreatePrintJobInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') trace: string, @Req() request: TenantRequest) {
    return this.collaboration.createPrintJob(input, request.tenantContext, meta(request, trace, key));
  }

  @Post('print-jobs/:jobId/claim') @HttpCode(200) @RequirePermission('platform.print.process')
  claimPrintJob(@Param('jobId') jobId: string, @Body() input: ClaimPrintJobInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') trace: string, @Req() request: TenantRequest) {
    return this.collaboration.claimPrintJob(jobId, input, request.tenantContext, meta(request, trace, key));
  }

  @Post('print-jobs/:jobId/complete') @HttpCode(200) @RequirePermission('platform.print.process')
  completePrintJob(@Param('jobId') jobId: string, @Body() input: CompletePrintJobInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') trace: string, @Req() request: TenantRequest) {
    return this.collaboration.completePrintJob(jobId, input, request.tenantContext, meta(request, trace, key));
  }

  @Post('print-jobs/:jobId/cancel') @HttpCode(200) @RequirePermission('platform.print.create')
  cancelPrintJob(@Param('jobId') jobId: string, @Body() input: VersionInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') trace: string, @Req() request: TenantRequest) {
    return this.collaboration.cancelPrintJob(jobId, input, request.tenantContext, meta(request, trace, key));
  }
}
