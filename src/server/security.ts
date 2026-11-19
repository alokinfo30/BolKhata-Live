import type { NextFunction, Request, Response } from 'express';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export const STATIC_ALLOWED_ORIGINS = new Set([
  'https://boalkhata.netlify.app',
  'https://netlify.app',
  'https://bolkhata-live.onrender.com',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
]);

export function isOriginAllowed(origin: string | undefined, extraOriginsCsv?: string): boolean {
  if (!origin) return true;
  let normalized = origin.trim();
  try {
    const parsed = new URL(normalized);
    normalized = parsed.origin;
  } catch {
    return false;
  }

  if (STATIC_ALLOWED_ORIGINS.has(normalized)) return true;

  if (extraOriginsCsv) {
    const extras = extraOriginsCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (extras.includes(normalized)) return true;
  }

  return (
    /^https:\/\/[a-z0-9-]+\.netlify\.app$/i.test(normalized) ||
    /^https:\/\/[a-z0-9-]+\.onrender\.com$/i.test(normalized) ||
    /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)?\.run\.app$/i.test(normalized)
  );
}

/**
 * Applies defense-in-depth HTTP security headers compatible with Google Auth popups
 * and iframe previews while blocking MIME sniffing and unauthorized hardware access.
 */
export function applySecurityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=(), payment=()');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

  const proto = req.headers['x-forwarded-proto'];
  if (req.secure || proto === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * In-memory sliding-window rate limiter for API & WebSocket endpoints.
 */
export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, number[]>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = Math.max(1, maxRequests);
    this.windowMs = Math.max(1000, windowMs);
  }

  check(key: string, nowMs = Date.now()): RateLimitDecision {
    const cutoff = nowMs - this.windowMs;
    const timestamps = (this.buckets.get(key) ?? []).filter((ts) => ts > cutoff);

    if (timestamps.length >= this.maxRequests) {
      const oldest = timestamps[0];
      const retryAfterSec = Math.max(1, Math.ceil((oldest + this.windowMs - nowMs) / 1000));
      this.buckets.set(key, timestamps);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec,
      };
    }

    timestamps.push(nowMs);
    this.buckets.set(key, timestamps);

    // Opportunistic memory bound cleanup
    if (this.buckets.size > 5000) {
      for (const [k, list] of this.buckets.entries()) {
        if (list.length === 0 || list[list.length - 1] <= cutoff) {
          this.buckets.delete(k);
        }
      }
    }

    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - timestamps.length),
      retryAfterSec: 0,
    };
  }
}

export function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

export function createRateLimitMiddleware(limiter: SlidingWindowRateLimiter, scope: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${scope}:${getClientIp(req)}`;
    const decision = limiter.check(key);
    res.setHeader('X-RateLimit-Remaining', String(decision.remaining));
    if (!decision.allowed) {
      res.setHeader('Retry-After', String(decision.retryAfterSec));
      res.status(429).json({
        error: 'Too many requests. Please wait a moment and try again.',
        retryAfterSeconds: decision.retryAfterSec,
      });
      return;
    }
    next();
  };
}

/**
 * Recursively strips prototype-pollution keys and truncates/cleans strings & arrays.
 */
export function sanitizePlainData(
  input: unknown,
  opts: { maxDepth?: number; maxArrayLen?: number; maxStringLen?: number } = {},
  depth = 0
): unknown {
  const maxDepth = opts.maxDepth ?? 4;
  const maxArrayLen = opts.maxArrayLen ?? 200;
  const maxStringLen = opts.maxStringLen ?? 500;

  if (depth > maxDepth) return undefined;
  if (input === null || input === undefined) return null;

  if (typeof input === 'string') {
    return input.replace(CONTROL_CHAR_RE, '').trim().slice(0, maxStringLen);
  }
  if (typeof input === 'number') {
    return Number.isFinite(input) ? input : 0;
  }
  if (typeof input === 'boolean') {
    return input;
  }
  if (Array.isArray(input)) {
    return input
      .slice(0, maxArrayLen)
      .map((item) => sanitizePlainData(item, opts, depth + 1))
      .filter((v) => v !== undefined);
  }
  if (typeof input === 'object') {
    const out: Record<string, unknown> = Object.create(null);
    let keysAdded = 0;
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (DANGEROUS_KEYS.has(k)) continue;
      if (keysAdded >= 30) break;
      const cleaned = sanitizePlainData(v, opts, depth + 1);
      if (cleaned !== undefined) {
        out[k] = cleaned;
        keysAdded += 1;
      }
    }
    return { ...out };
  }
  return undefined;
}

export interface ValidatedSentimentInput {
  comment: string;
  rating: number;
}

export function validateSentimentPayload(
  body: unknown
): { ok: true; data: ValidatedSentimentInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const rec = body as Record<string, unknown>;
  if (typeof rec.comment !== 'string') {
    return { ok: false, error: 'Comment is required and must be text.' };
  }
  const comment = rec.comment.replace(CONTROL_CHAR_RE, '').trim();
  if (comment.length === 0) {
    return { ok: false, error: 'Comment cannot be empty.' };
  }
  if (comment.length > 500) {
    return { ok: false, error: 'Comment must be 500 characters or fewer.' };
  }

  const rawRating = rec.rating === undefined ? 5 : Number(rec.rating);
  if (!Number.isFinite(rawRating) || rawRating < 1 || rawRating > 5) {
    return { ok: false, error: 'Rating must be a number between 1 and 5.' };
  }

  return {
    ok: true,
    data: {
      comment,
      rating: Math.round(rawRating),
    },
  };
}

export interface ValidatedInsightsInput {
  customers: Record<string, unknown>[];
  inventory: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
  restocks: Record<string, unknown>[];
  approvals: Record<string, unknown>[];
  sentimentLogs: Record<string, unknown>[];
}

function pickRecordFields(
  list: unknown,
  allowedKeys: string[],
  maxItems: number
): Record<string, unknown>[] {
  if (!Array.isArray(list)) return [];
  const results: Record<string, unknown>[] = [];
  for (const rawItem of list.slice(0, maxItems)) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) continue;
    const src = rawItem as Record<string, unknown>;
    const clean: Record<string, unknown> = {};
    for (const key of allowedKeys) {
      if (DANGEROUS_KEYS.has(key)) continue;
      if (key in src && src[key] !== undefined) {
        clean[key] = sanitizePlainData(src[key], { maxDepth: 2, maxArrayLen: 15, maxStringLen: 240 });
      }
    }
    results.push(clean);
  }
  return results;
}

export function validateInsightsPayload(
  body: unknown
): { ok: true; data: ValidatedInsightsInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const rec = body as Record<string, unknown>;
  const arrayKeys = [
    'customers',
    'inventory',
    'transactions',
    'restocks',
    'approvals',
    'sentimentLogs',
  ] as const;

  for (const key of arrayKeys) {
    if (rec[key] !== undefined && !Array.isArray(rec[key])) {
      return { ok: false, error: `Field "${key}" must be an array.` };
    }
  }

  return {
    ok: true,
    data: {
      customers: pickRecordFields(
        rec.customers,
        ['name', 'phone', 'location', 'current_udhaar_balance', 'credit_limit'],
        100
      ),
      inventory: pickRecordFields(
        rec.inventory,
        ['sku', 'name', 'unit', 'stock_qty', 'unit_price', 'reorder_threshold', 'supplier_name'],
        100
      ),
      transactions: pickRecordFields(
        rec.transactions,
        ['tx_id', 'customer_name', 'item_name', 'unit', 'qty', 'total_amount', 'type', 'status'],
        150
      ),
      restocks: pickRecordFields(
        rec.restocks,
        ['po_number', 'item_sku', 'item_name', 'supplier_name', 'order_qty', 'unit', 'estimated_cost', 'status'],
        50
      ),
      approvals: pickRecordFields(
        rec.approvals,
        ['approval_id', 'customer_name', 'item_name', 'qty', 'total_amount', 'tx_type', 'reason', 'status'],
        50
      ),
      sentimentLogs: pickRecordFields(
        rec.sentimentLogs,
        ['rating', 'sentiment', 'category', 'comment', 'ai_summary'],
        50
      ),
    },
  };
}
