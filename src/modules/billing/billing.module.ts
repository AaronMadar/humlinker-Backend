/**
 * BillingModule — offres, quotas, disjoncteurs globaux et suivi des coûts.
 * @Global() → QuotaService (PrismaService et RedisService sont déjà globaux) injectable partout (messages, humlinkers, OTP).
 * StripeService : abonnement Pro (Checkout, portail client, webhooks).
 */
import { Global, Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { QuotaService } from './quota.service';
import { StripeService } from './stripe.service';

@Global()
@Module({
  controllers: [BillingController],
  providers: [QuotaService, StripeService],
  exports: [QuotaService, StripeService],
})
export class BillingModule {}
