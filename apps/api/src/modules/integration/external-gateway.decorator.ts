import { SetMetadata } from '@nestjs/common';

export const EXTERNAL_GATEWAY_BYPASS = 'scm:external-gateway:bypass';

export const ExternalGatewayBypass = (
  reason: 'ADMIN_DIAGNOSTIC' | 'TOKEN_ISSUE',
) => SetMetadata(EXTERNAL_GATEWAY_BYPASS, reason);
