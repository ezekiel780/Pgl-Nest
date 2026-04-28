import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      inject: [ConfigService],
      useFactory: async (cfg: ConfigService) => {
        const Redis = await import('ioredis');
        const client = new Redis.default({
          host: cfg.get('REDIS_HOST', 'localhost'),
          port: +cfg.get('REDIS_PORT', 6379),
          retryStrategy: (times) => Math.min(times * 50, 2000),
          lazyConnect: true,
        });
        await client.connect();
        return client;
      },
    },
    RedisService,
  ],
  exports: [RedisService],
})
export class RedisModule {}
