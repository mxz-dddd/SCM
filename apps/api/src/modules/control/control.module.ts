import { Module } from '@nestjs/common';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { PermissionService } from '../platform/auth/permission.service';
import { PlatformModule } from '../platform/platform.module';
import { ControlTowerController } from './control-tower.controller';
import { ControlTowerService } from './control-tower.service';

@Module({
  controllers: [ControlTowerController],
  imports: [PlatformModule],
  providers: [ControlTowerService, PermissionGuard, PermissionService],
})
export class ControlModule {}
