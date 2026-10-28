import { Request, Response, NextFunction } from "express";

// ============================================================================
// PLUGGABLE RATE LIMITER MIDDLEWARE
// ============================================================================
// Architecture:
// Uses a pluggable Store interface. Defaults to InMemorySlidingWindowStore.
//
// Operational Limitation Notice:
// The InMemorySlidingWindowStore is local to this Node.js process heap.
// In a multi-instance, auto-scaled, or clustered container deployment,
// limit state is not shared across instances. For multi-instance clusters,
// a RedisRateLimitStore implementing RateLimitStore should be plugged in.
// ============================================================================

export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }>;
  reset?(key: string): Promise<void>;
  resetAll?(): Promise<void>;
}

export class InMemorySlidingWindowStore implements RateLimitStore {
  private map = new Map<string, number[]>();

  constructor() {
    // Periodic garbage collection of stale entries
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [key, timestamps] of this.map.entries()) {
        const recent = timestamps.filter((t) => now - t < 120000);
        if (recent.length === 0) {
          this.map.delete(key);
        } else {
          this.map.set(key, recent);
        }
      }
    }, 60000);
    if (timer.unref) timer.unref();
  }

  async increment(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }> {
    const now = Date.now();
    const timestamps = this.map.get(key) || [];
    const recent = timestamps.filter((t) => now - t < windowMs);
    recent.push(now);
    this.map.set(key, recent);

    const oldest = recent[0] || now;
    const ttlMs = Math.max(0, windowMs - (now - oldest));
    return { count: recent.length, ttlMs };
  }

  async reset(key: string): Promise<void> {
    this.map.delete(key);
  }

  async resetAll(): Promise<void> {
    this.map.clear();
  }
}

export const defaultRateLimitStore: RateLimitStore = new InMemorySlidingWindowStore();

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  keyGenerator?: (req: Request) => string;
  errorCode?: string;
  errorMessage?: string;
  store?: RateLimitStore;
}

/**
 * Creates an Express rate-limiting middleware with custom window and limits.
 */
export function createRateLimiter(options: RateLimiterOptions) {
  // Use a dedicated in-memory store per limiter by default to prevent cross-route collisions
  const store = options.store || new InMemorySlidingWindowStore();
  const defaultKeyGen = (req: Request) => {
    // In non-production testing, allow test suites to pass an explicit x-test-client-ip header
    // to isolate test bursts without affecting other test suites or localhost.
    // In production, this header is strictly ignored to prevent client IP spoofing.
    if (process.env.NODE_ENV !== "production") {
      const testIp = req.headers["x-test-client-ip"];
      if (typeof testIp === "string" && testIp.trim().length > 0) {
        return testIp.trim();
      }
    }
    return req.ip || req.socket.remoteAddress || "unknown";
  };
  const keyGen = options.keyGenerator || defaultKeyGen;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = keyGen(req);
      const { count, ttlMs } = await store.increment(key, options.windowMs);

      res.setHeader("X-RateLimit-Limit", options.max);
      res.setHeader("X-RateLimit-Remaining", Math.max(0, options.max - count));

      if (count > options.max) {
        const retryAfterSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
        res.setHeader("Retry-After", String(retryAfterSeconds));
        return res.status(429).json({
          error: options.errorMessage || "Too many requests. Please try again later.",
          code: options.errorCode || "RATE_LIMIT_EXCEEDED",
          retryAfter: retryAfterSeconds,
        });
      }

      return next();
    } catch {
      // Fail open so an error in rate limiting never breaks customer API requests
      return next();
    }
  };
}
