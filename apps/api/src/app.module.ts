import {
  MiddlewareConsumer,
  Module,
  RequestMethod,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health.controller';
import { AmsModule } from './modules/ams/ams.module';
import { BillingModule } from './modules/billing/billing.module';
import { ControlModule } from './modules/control/control.module';
import { MdmModule } from './modules/mdm/mdm.module';
import { IntegrationModule } from './modules/integration/integration.module';
import { OmsModule } from './modules/oms/oms.module';
import { AuthModule } from './modules/platform/auth/auth.module';
import { TenantContextMiddleware } from './modules/platform/auth/tenant-context.middleware';
import { PlatformModule } from './modules/platform/platform.module';
import { IdempotencyInterceptor } from './modules/platform/idempotency.interceptor';
import { OperationalTelemetryInterceptor } from './modules/platform/operational-telemetry.interceptor';
import { TmsModule } from './modules/tms/tms.module';
import { WmsModule } from './modules/wms/wms.module';

@Module({
  imports: [
    AmsModule,
    BillingModule,
    ControlModule,
    DatabaseModule,
    IntegrationModule,
    AuthModule,
    MdmModule,
    OmsModule,
    PlatformModule,
    TmsModule,
    WmsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: OperationalTelemetryInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TenantContextMiddleware)
      .exclude(
        { method: RequestMethod.GET, path: 'health' },
        {
          method: RequestMethod.GET,
          path: 'api/v1/public/tracking/:token',
        },
        { method: RequestMethod.POST, path: 'api/v1/auth/login' },
        { method: RequestMethod.POST, path: 'api/v1/external/oauth/token' },
        {
          method: RequestMethod.POST,
          path: 'api/v1/external/gateway/authorize',
        },
        { method: RequestMethod.POST, path: 'api/v1/external/iot/heartbeat' },
        { method: RequestMethod.POST, path: 'api/v1/external/iot/telemetry' },
        {
          method: RequestMethod.POST,
          path: 'api/v1/external/iot/command-acknowledgements',
        },
        {
          method: RequestMethod.GET,
          path: 'api/v1/public/openapi/:tenantId/:name/:version',
        },
      )
      .forRoutes('*');
  }
}
