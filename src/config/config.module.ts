import { Global, Module } from '@nestjs/common';
import configuration from './configuration';

export const APP_CONFIG = 'APP_CONFIG';

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: configuration,
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
