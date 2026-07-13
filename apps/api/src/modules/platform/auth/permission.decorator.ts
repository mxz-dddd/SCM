import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSION = 'scm.required-permission';

export const RequirePermission = (permissionCode: string) =>
  SetMetadata(REQUIRED_PERMISSION, permissionCode);
