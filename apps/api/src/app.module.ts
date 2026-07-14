import {
  MiddlewareConsumer,
  Module,
  RequestMethod,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health.controller';
import { MdmModule } from './modules/mdm/mdm.module';
import { AuthModule } from './modules/platform/auth/auth.module';
import { TenantContextMiddleware } from './modules/platform/auth/tenant-context.middleware';
import { PlatformModule } from './modules/platform/platform.module';

@Module({
  imports: [DatabaseModule, AuthModule, MdmModule, PlatformModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TenantContextMiddleware)
      .exclude(
        { method: RequestMethod.GET, path: 'health' },
        { method: RequestMethod.POST, path: 'api/v1/auth/login' },
      )
      .forRoutes('*');
  }
}
