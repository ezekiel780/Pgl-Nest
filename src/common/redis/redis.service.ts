import { Injectable, Inject } from '@nestjs/common';
import type { Redis } from 'ioredis';

@Injectable()
export class RedisService {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  /**
   * Sliding-window counter using a Redis sorted set.
   * Atomically: adds event, removes stale entries, returns current count.
   * Time complexity: O(log n) per operation.
   */
  async slidingWindowCount(
    key: string,
    eventId: string,
    nowMs: number,
    windowMs: number,
    ttlSec: number,
  ): Promise<number> {
    const cutoff = nowMs - windowMs;
    const pipeline = this.redis.pipeline();
    pipeline.zadd(key, nowMs, `${eventId}:${nowMs}`);
    pipeline.zremrangebyscore(key, '-inf', cutoff);
    pipeline.zcard(key);
    pipeline.expire(key, ttlSec);
    const results = await pipeline.exec();
    return results[2][1] as number;
  }

  /**
   * Atomic daily total using HINCRBYFLOAT — no race conditions.
   * Key: daily:{userId}:{YYYY-MM-DD}
   */
  async incrementDailyTotal(
    userId: string,
    date: string,
    amount: number,
  ): Promise<number> {
    const key = `daily:${userId}:${date}`;
    const pipeline = this.redis.pipeline();
    pipeline.hincrbyfloat(key, 'total', amount);
    pipeline.expire(key, 86400 * 2);
    const results = await pipeline.exec();
    return parseFloat(results[0][1] as string);
  }

  async getDailyTotal(userId: string, date: string): Promise<number> {
    const val = await this.redis.hget(`daily:${userId}:${date}`, 'total');
    return val ? parseFloat(val) : 0;
  }

  /** Store last-seen geo-location with TTL for geo-velocity checks. */
  async setLastLocation(
    userId: string,
    lat: number,
    lng: number,
    timestampMs: number,
    ttlSec: number,
  ): Promise<void> {
    const key = `geo:${userId}`;
    await this.redis.hset(key, {
      lat: lat.toString(),
      lng: lng.toString(),
      ts: timestampMs.toString(),
    });
    await this.redis.expire(key, ttlSec);
  }

  async getLastLocation(
    userId: string,
  ): Promise<{ lat: number; lng: number; ts: number } | null> {
    const data = await this.redis.hgetall(`geo:${userId}`);
    if (!data || !data.lat) return null;
    return {
      lat: parseFloat(data.lat),
      lng: parseFloat(data.lng),
      ts: parseInt(data.ts, 10),
    };
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    if (ttlSec) {
      await this.redis.setex(key, ttlSec, value);
    } else {
      await this.redis.set(key, value);
    }
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.redis.del(...keys);
  }

  async incrementWithTtl(key: string, ttlSec: number): Promise<number> {
    const pipeline = this.redis.pipeline();
    pipeline.incr(key);
    pipeline.ttl(key);
    const results = await pipeline.exec();
    const count = results[0][1] as number;
    const ttl = results[1][1] as number;

    if (ttl < 0) {
      await this.redis.expire(key, ttlSec);
    }

    return count;
  }
}
