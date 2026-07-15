import { Module } from '@nestjs/common';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { PlatformModule } from '../platform/platform.module';
import { ApiContractService } from './api-contract.service';
import { AdapterIotController, ExternalIotController } from './adapter-iot.controller';
import { AdapterIotService } from './adapter-iot.service';
import { GatewayService } from './gateway.service';
import { MessageExchangeController } from './message-exchange.controller';
import { MessageExchangeService } from './message-exchange.service';
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
    PublicApiContractController,
  ],
  imports: [PlatformModule],
  providers: [
    AdapterIotService,
    ApiContractService,
    GatewayService,
    MessageExchangeService,
    PermissionGuard,
    PermissionService,
  ],
})
export class IntegrationModule {}
