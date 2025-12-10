import { config } from '../config.js';
import { log } from '../utils/logger.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
  windowStart: number;
}

export class RateLimiter {
  private entries = new Map<string, RateLimitEntry>();
  private cleanupInterval?: NodeJS.Timeout;
  private readonly windowMs = 60 * 1000; // 1 minute window

  constructor() {
    this.startCleanup();
  }

  /**
   * Check if request should be allowed
   * @returns {allowed: boolean, retryAfter?: number} - retryAfter in seconds if not allowed
   */
  checkLimit(identifier: string, maxRequests: number): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    let entry = this.entries.get(identifier);

    // Clean up expired entries or initialize new one
    if (!entry || entry.resetAt <= now) {
      entry = {
        count: 0,
        resetAt: now + this.windowMs,
        windowStart: now,
      };
      this.entries.set(identifier, entry);
    }

    // Check limit
    if (entry.count >= maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      return { allowed: false, retryAfter };
    }

    // Increment count and allow
    entry.count++;
    return { allowed: true };
  }

  /**
   * Get remaining requests for an identifier
   */
  getRemaining(identifier: string, maxRequests: number): number {
    const entry = this.entries.get(identifier);
    if (!entry || entry.resetAt <= Date.now()) {
      return maxRequests;
    }
    return Math.max(0, maxRequests - entry.count);
  }

  /**
   * Reset rate limit for an identifier (useful for testing)
   */
  reset(identifier: string): void {
    this.entries.delete(identifier);
  }

  /**
   * Start periodic cleanup of expired entries
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000); // Every 5 minutes
    
    // Allow process to exit even if interval is running (for tests)
    if (this.cleanupInterval && typeof this.cleanupInterval.unref === 'function') {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [identifier, entry] of this.entries.entries()) {
      if (entry.resetAt <= now) {
        this.entries.delete(identifier);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log(`Rate limiter: cleaned up ${cleaned} expired entries`);
    }
  }

  /**
   * Stop the rate limiter and cleanup interval
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.entries.clear();
  }

  /**
   * Get current entry count (for metrics)
   */
  getEntryCount(): number {
    return this.entries.size;
  }
}

// Singleton instances for different endpoints
export const slashCommandRateLimiter = new RateLimiter();
export const healthRateLimiter = new RateLimiter();

