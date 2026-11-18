import { Controller, Get } from '@nestjs/common';
import type { ApiResponse } from '@/common';
import { Public } from '@/decorators';
import { SkipRateLimit } from '@/common/rate-limit';

@SkipRateLimit()
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check(): ApiResponse<{ status: string }> {
    return {
      success: true,
      data: { status: 'ok' },
      timestamp: new Date().toISOString(),
    };
  }
}
