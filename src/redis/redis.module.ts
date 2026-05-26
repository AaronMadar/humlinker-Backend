/**
 * RedisModule — Module global NestJS pour ioredis.
 *
 * @Global() → injecté une seule fois dans AppModule,
 * disponible dans tous les autres modules sans réimport.
 *
 * La connexion Redis est créée via une factory qui lit la config
 * (host, port, password) depuis APP_CONFIG.
 */
import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG } from '../config';
import configuration from '../config/configuration';
import { REDIS_CLIENT } from './redis.constants';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: ReturnType<typeof configuration>): Redis => {
        return new Redis({
          host: config.redis.host,
          port: config.redis.port,
          password: config.redis.password,
          // Reconnexion automatique en cas de coupure
          retryStrategy: (times) => Math.min(times * 100, 3000),
        });
      },
    },
    RedisService,
  ],
  exports: [RedisService],
})
export class RedisModule {}
