import { Controller, Get } from '@nestjs/common';
import type { ApiResponse } from '../../common';

@Controller('health')
export class HealthController {
  @Get()
  check(): ApiResponse<{ status: string }> {
    return {
      success: true,
      data: { status: 'ok' },
      timestamp: new Date().toISOString(),
    };
  }
}
