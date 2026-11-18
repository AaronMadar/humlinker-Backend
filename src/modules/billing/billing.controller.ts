import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { ApiResponse as AppApiResponse } from '../../common';
import { CurrentUser } from '../../decorators';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { QuotaService, type UsageSummary } from './quota.service';

@ApiTags('Billing')
@ApiBearerAuth()
@Controller('billing')
export class BillingController {
  constructor(private readonly quotaService: QuotaService) {}

  @Get('usage')
  @ApiOperation({
    summary: 'Ma consommation',
    description:
      'Offre actuelle, limites et consommation du jour et du mois (UTC) pour chaque quota, + nombre de humlinkers actifs lancés.',
  })
  @ApiResponse({ status: 200, description: 'Résumé de consommation.' })
  async getUsage(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AppApiResponse<UsageSummary>> {
    const data = await this.quotaService.getUsage(user.userId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
