import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { IdempotencyService } from './idempotency.service';
import { ServiceAccountController } from './service-account.controller';
import { ServiceAccountService } from './service-account.service';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

@Module({
  controllers: [ServiceAccountController, TenantController],
  imports: [AuthModule],
  providers: [IdempotencyService, ServiceAccountService, TenantService],
})
export class PlatformModule {}
