import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

const toNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      inject: [ConfigService],
      useFactory: async (cfg: ConfigService) => {
        const Redis = await import('ioredis');
        const options = {
          retryStrategy: (times: number) =>
            Math.min(
              times * toNumber(cfg.get<string>('REDIS_RETRY_MULTIPLIER'), 50),
              toNumber(cfg.get<string>('REDIS_RETRY_MAX_DELAY'), 2000),
            ),
          lazyConnect: true,
        };
        const redisUrl = cfg.get<string>('REDIS_URL');

        const client = redisUrl
          ? new Redis.default(redisUrl, options)
          : new Redis.default({
              ...options,
              host: cfg.get<string>('REDIS_HOST', 'localhost'),
              port: toNumber(cfg.get<string>('REDIS_PORT'), 6379),
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
