import { describe, expect, it } from 'vitest';
import {
  isOriginAllowed,
  sanitizePlainData,
  SlidingWindowRateLimiter,
  validateInsightsPayload,
  validateSentimentPayload,
} from '../src/server/security';
import {
  generateContentWithRetry,
  parseGeminiApiError,
} from '../src/server/geminiResilience';

describe('Server Security Hardening', () => {
  it('enforces strict CORS origin allowlist and blocks untrusted origins', () => {
    expect(isOriginAllowed(undefined)).toBe(true);
    expect(isOriginAllowed('https://boalkhata.netlify.app')).toBe(true);
    expect(isOriginAllowed('https://netlify.app')).toBe(true);
    expect(isOriginAllowed('https://bolkhata-live.onrender.com')).toBe(true);
    expect(isOriginAllowed('http://localhost:5173')).toBe(true);
    expect(isOriginAllowed('http://localhost:3000')).toBe(true);
    expect(isOriginAllowed('https://preview-123.netlify.app')).toBe(true);
    expect(isOriginAllowed('https://ais-pre-abc.asia-east1.run.app')).toBe(true);

    // Untrusted/malicious origins MUST be rejected
    expect(isOriginAllowed('https://evil-phishing.example')).toBe(false);
    expect(isOriginAllowed('https://boalkhata.netlify.app.evil.com')).toBe(false);
    expect(isOriginAllowed('http://boalkhata.netlify.app')).toBe(false);
    expect(isOriginAllowed('javascript:alert(1)')).toBe(false);
    expect(isOriginAllowed('not-a-valid-url')).toBe(false);
  });

  it('strips prototype-pollution keys and truncates oversized inputs', () => {
    const poisoned = JSON.parse(
      '{"name":"Sharma","__proto__":{"polluted":true},"constructor":{"bad":1},"nested":{"prototype":{"x":1},"ok":"yes"}}'
    );
    const cleaned = sanitizePlainData(poisoned) as Record<string, unknown>;
    expect(cleaned.name).toBe('Sharma');
    expect(Object.prototype.hasOwnProperty.call(cleaned, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(cleaned, 'constructor')).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    const longString = 'A'.repeat(2000);
    expect((sanitizePlainData(longString, { maxStringLen: 100 }) as string).length).toBe(100);
  });

  it('validates /api/sentiment/analyze payloads strictly', () => {
    expect(validateSentimentPayload(null).ok).toBe(false);
    expect(validateSentimentPayload({ comment: '' }).ok).toBe(false);
    expect(validateSentimentPayload({ comment: 'x'.repeat(501), rating: 5 }).ok).toBe(false);
    expect(validateSentimentPayload({ comment: 'Good', rating: 9 }).ok).toBe(false);
    expect(validateSentimentPayload({ comment: 'Good', rating: 0 }).ok).toBe(false);

    const valid = validateSentimentPayload({ comment: '  Voice fast hai!\x00 ', rating: 5 });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.data.comment).toBe('Voice fast hai!');
      expect(valid.data.rating).toBe(5);
    }
  });

  it('validates /api/insights/generate payloads and strips unexpected fields', () => {
    expect(validateInsightsPayload('not-object').ok).toBe(false);
    expect(validateInsightsPayload({ customers: 'not-array' }).ok).toBe(false);

    const valid = validateInsightsPayload({
      customers: [
        {
          name: 'Sharma Store',
          phone: '+91 98112 40120',
          current_udhaar_balance: 14500,
          credit_limit: 50000,
          secretAdminToken: 'SHOULD_BE_STRIPPED',
        },
      ],
      transactions: [],
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.data.customers).toHaveLength(1);
      expect(valid.data.customers[0].name).toBe('Sharma Store');
      expect('secretAdminToken' in valid.data.customers[0]).toBe(false);
    }
  });

  it('enforces sliding-window rate limits with accurate retryAfterSeconds', () => {
    const limiter = new SlidingWindowRateLimiter(3, 10_000);
    const t0 = 1_000_000;

    expect(limiter.check('ip:1', t0).allowed).toBe(true);
    expect(limiter.check('ip:1', t0 + 1000).allowed).toBe(true);
    expect(limiter.check('ip:1', t0 + 2000).allowed).toBe(true);

    const blocked = limiter.check('ip:1', t0 + 3000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBe(7);

    // Different IP is unaffected
    expect(limiter.check('ip:2', t0 + 3000).allowed).toBe(true);

    // After window slides past t0, quota recovers
    expect(limiter.check('ip:1', t0 + 10_001).allowed).toBe(true);
  });
});

describe('Gemini API 503 UNAVAILABLE Resilience & Failover', () => {
  const real503Error = new Error(
    '{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}'
  );

  it('classifies Gemini 503 UNAVAILABLE error accurately as retryable HTTP 503 (not 500)', () => {
    const parsed = parseGeminiApiError(real503Error);
    expect(parsed.status).toBe(503);
    expect(parsed.code).toBe('UNAVAILABLE');
    expect(parsed.retryable).toBe(true);
    expect(parsed.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('retries transient 503 and succeeds on primary model when spike clears', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = await generateContentWithRetry(
      async ({ model }) => {
        calls += 1;
        if (calls === 1) throw real503Error;
        return { text: JSON.stringify({ ok: true, model }) };
      },
      {
        contents: 'test',
        config: {},
        maxAttemptsPerModel: 2,
        baseDelayMs: 100,
        sleepFn: async (ms) => {
          sleeps.push(ms);
        },
      }
    );

    expect(result.modelUsed).toBe('gemini-4-hydrogen');
    expect(result.attempts).toBe(2);
    expect(sleeps).toEqual([100]);
  });

  it('automatically fails over from gemini-4-hydrogen to gemini-3.1-flash-lite on persistent 503', async () => {
    const invokedModels: string[] = [];
    const result = await generateContentWithRetry(
      async ({ model }) => {
        invokedModels.push(model);
        if (model === 'gemini-4-hydrogen') {
          throw real503Error;
        }
        return { text: '{"ok":true}' };
      },
      {
        contents: 'test',
        config: {},
        maxAttemptsPerModel: 2,
        baseDelayMs: 0,
      }
    );

    expect(invokedModels).toEqual([
      'gemini-4-hydrogen',
      'gemini-4-hydrogen',
      'gemini-3.1-flash-lite',
    ]);
    expect(result.modelUsed).toBe('gemini-3.1-flash-lite');
    expect(result.attempts).toBe(3);
  });

  it('does NOT retry non-retryable 403 PERMISSION_DENIED errors', async () => {
    let calls = 0;
    await expect(
      generateContentWithRetry(
        async () => {
          calls += 1;
          throw new Error('{"error":{"code":403,"message":"API_KEY_INVALID","status":"PERMISSION_DENIED"}}');
        },
        {
          contents: 'test',
          config: {},
          maxAttemptsPerModel: 3,
          baseDelayMs: 0,
        }
      )
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
