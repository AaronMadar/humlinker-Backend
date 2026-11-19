import { IsIn, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SUPPORTED_CURRENCIES } from '../stripe.service';
import type { BillingCurrency, BillingInterval } from '../stripe.service';

export class CheckoutDto {
  @ApiProperty({
    enum: ['month', 'year'],
    example: 'month',
    description: 'Formule Pro : mensuelle ou annuelle.',
  })
  @IsIn(['month', 'year'])
  interval!: BillingInterval;

  @ApiProperty({
    enum: SUPPORTED_CURRENCIES,
    required: false,
    example: 'usd',
    description:
      'Devise de paiement selon la localisation du client (défaut : usd).',
  })
  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: BillingCurrency;
}
