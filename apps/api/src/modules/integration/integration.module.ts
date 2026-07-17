import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { PlatformModule } from '../platform/platform.module';
import { ApiContractService } from './api-contract.service';
import {
  AdapterIotController,
  ExternalIotController,
} from './adapter-iot.controller';
import { AdapterIotService } from './adapter-iot.service';
import { GatewayService } from './gateway.service';
import { ExternalGatewayGuard } from './external-gateway.guard';
import { WebhookEndpointPolicy } from './webhook-endpoint.policy';
import { MessageExchangeController } from './message-exchange.controller';
import { MessageExchangeService } from './message-exchange.service';
import { MobilePortalController } from './mobile-portal.controller';
import { MobilePortalService } from './mobile-portal.service';
import {
  ExternalGatewayController,
  IntegrationController,
  PublicApiContractController,
} from './integration.controller';

@Module({
  controllers: [
    AdapterIotController,
    ExternalGatewayController,
    ExternalIotController,
    IntegrationController,
    MessageExchangeController,
    MobilePortalController,
    PublicApiContractController,
  ],
  imports: [PlatformModule],
  providers: [
    AdapterIotService,
    ApiContractService,
    GatewayService,
    { provide: APP_GUARD, useClass: ExternalGatewayGuard },
    MessageExchangeService,
    WebhookEndpointPolicy,
    MobilePortalService,
    PermissionGuard,
    PermissionService,
  ],
})
export class IntegrationModule {}
