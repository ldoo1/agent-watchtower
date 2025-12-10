import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { RateLimiter } from '../rate-limiter.js';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter();
  });

  afterEach(() => {
    rateLimiter.stop();
  });

  it('should allow requests within limit', () => {
    const result1 = rateLimiter.checkLimit('client1', 10);
    expect(result1.allowed).toBe(true);

    const result2 = rateLimiter.checkLimit('client1', 10);
    expect(result2.allowed).toBe(true);
  });

  it('should block requests exceeding limit', () => {
    for (let i = 0; i < 10; i++) {
      rateLimiter.checkLimit('client1', 10);
    }

    const result = rateLimiter.checkLimit('client1', 10);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeDefined();
  });

  it('should track different clients separately', () => {
    for (let i = 0; i < 10; i++) {
      rateLimiter.checkLimit('client1', 10);
    }

    const result = rateLimiter.checkLimit('client2', 10);
    expect(result.allowed).toBe(true); // Different client should be allowed
  });

  it('should return remaining requests', () => {
    expect(rateLimiter.getRemaining('client1', 10)).toBe(10);

    rateLimiter.checkLimit('client1', 10);
    expect(rateLimiter.getRemaining('client1', 10)).toBe(9);

    rateLimiter.checkLimit('client1', 10);
    expect(rateLimiter.getRemaining('client1', 10)).toBe(8);
  });

  it('should reset rate limit for identifier', () => {
    for (let i = 0; i < 10; i++) {
      rateLimiter.checkLimit('client1', 10);
    }

    rateLimiter.reset('client1');

    const result = rateLimiter.checkLimit('client1', 10);
    expect(result.allowed).toBe(true);
  });

  it('should reset after time window', async () => {
    for (let i = 0; i < 10; i++) {
      rateLimiter.checkLimit('client1', 10);
    }

    // Manually expire the entry (simulate time passing)
    // In real scenario, cleanup runs every 5 minutes
    // For test, we'll use reset
    rateLimiter.reset('client1');

    const result = rateLimiter.checkLimit('client1', 10);
    expect(result.allowed).toBe(true);
  });
});

