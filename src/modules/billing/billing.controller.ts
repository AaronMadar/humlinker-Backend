import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type { ApiResponse as AppApiResponse } from '../../common';
import { HOUR, RateLimit, SkipRateLimit } from '../../common/rate-limit';
import { CurrentUser, Public } from '../../decorators';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CheckoutDto } from './dto/checkout.dto';
import { QuotaService, type UsageSummary } from './quota.service';
import { StripeService, type PublicPrice } from './stripe.service';

@ApiTags('Billing')
@ApiBearerAuth()
@Controller('billing')
export class BillingController {
  constructor(
    private readonly quotaService: QuotaService,
    private readonly stripeService: StripeService,
  ) {}

  @Get('usage')
  @ApiOperation({
    summary: 'Ma consommation',
    description:
      'Offre actuelle, abonnement, limites et consommation du jour et du mois pour chaque quota, + humlinkers actifs lancés.',
  })
  @ApiResponse({ status: 200, description: 'Résumé de consommation.' })
  async getUsage(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AppApiResponse<UsageSummary & { billingEnabled: boolean }>> {
    const data = await this.quotaService.getUsage(user.userId);
    return {
      success: true,
      data: { ...data, billingEnabled: this.stripeService.enabled },
      timestamp: new Date().toISOString(),
    };
  }

  @Get('prices')
  @ApiOperation({
    summary: 'Tarifs Pro',
    description: 'Prix mensuel et annuel (centimes), lus depuis Stripe.',
  })
  async getPrices(): Promise<AppApiResponse<PublicPrice[]>> {
    const data = await this.stripeService.getPrices();
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post('checkout')
  @RateLimit({ name: 'hour', by: 'user', limit: 10, windowSec: HOUR })
  @ApiOperation({
    summary: 'Passer à Pro',
    description:
      "Crée une session Stripe Checkout et retourne l'URL de paiement vers laquelle rediriger.",
  })
  @ApiResponse({
    status: 201,
    description: '{ url } — page de paiement Stripe.',
  })
  @ApiResponse({ status: 409, description: 'Abonnement Pro déjà actif.' })
  async checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CheckoutDto,
  ): Promise<AppApiResponse<{ url: string }>> {
    const url = await this.stripeService.createCheckoutSession(
      user.userId,
      dto.interval,
    );
    return {
      success: true,
      data: { url },
      timestamp: new Date().toISOString(),
    };
  }

  @Post('portal')
  @RateLimit({ name: 'hour', by: 'user', limit: 20, windowSec: HOUR })
  @ApiOperation({
    summary: 'Gérer mon abonnement',
    description: 'URL du portail client Stripe (résiliation, carte, factures).',
  })
  async portal(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AppApiResponse<{ url: string }>> {
    const url = await this.stripeService.createPortalSession(user.userId);
    return {
      success: true,
      data: { url },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Webhook Stripe — appelé par Stripe, pas par le front.
   * Signature vérifiée sur le corps brut. Une erreur renvoie 5xx → Stripe réessaie.
   */
  @Public()
  @SkipRateLimit()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    const event = this.stripeService.constructEvent(req.rawBody, signature);
    await this.stripeService.handleEvent(event);
    return { received: true };
  }
}
