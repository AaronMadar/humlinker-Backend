/**
 * BillingModule — offres, quotas, disjoncteurs globaux et suivi des coûts.
 * @Global() → QuotaService (PrismaService et RedisService sont déjà globaux) injectable partout (messages, humlinkers, OTP).
 * Le paiement Stripe viendra s'ajouter ici (étape 3).
 */
import { Global, Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { QuotaService } from './quota.service';

@Global()
@Module({
  controllers: [BillingController],
  providers: [QuotaService],
  exports: [QuotaService],
})
export class BillingModule {}
