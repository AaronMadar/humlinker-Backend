import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { BillingInterval } from '../stripe.service';

export class CheckoutDto {
  @ApiProperty({
    enum: ['month', 'year'],
    example: 'month',
    description: 'Formule Pro : mensuelle ou annuelle.',
  })
  @IsIn(['month', 'year'])
  interval!: BillingInterval;
}
