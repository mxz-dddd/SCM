import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@scm/shared';

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return {
      service: 'api',
      status: 'ok',
    };
  }
}
