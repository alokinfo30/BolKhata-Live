import { ThinkingLevel } from '@google/genai';

export interface ParsedGeminiError {
  status: number;
  code: string;
  retryable: boolean;
  userMessage: string;
  retryAfterSeconds?: number;
}

export function parseGeminiApiError(err: unknown): ParsedGeminiError {
  const rawMessage = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  let status = 500;
  let code = 'INTERNAL';
  let extractedMessage = rawMessage;

  if (err && typeof err === 'object') {
    const rec = err as { status?: number; code?: number; statusCode?: number };
    const candidate = rec.status ?? rec.code ?? rec.statusCode;
    if (typeof candidate === 'number' && candidate >= 400 && candidate <= 599) {
      status = candidate;
    }
  }

  // Gemini SDK often embeds JSON error payload inside Error.message
  const jsonStart = rawMessage.indexOf('{');
  const jsonEnd = rawMessage.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(rawMessage.slice(jsonStart, jsonEnd + 1)) as {
        error?: { code?: number; message?: string; status?: string };
      };
      if (parsed?.error) {
        if (typeof parsed.error.code === 'number') status = parsed.error.code;
        if (typeof parsed.error.status === 'string') code = parsed.error.status;
        if (typeof parsed.error.message === 'string') extractedMessage = parsed.error.message;
      }
    } catch {
      // ignore non-JSON braces
    }
  }

  const lower = `${code} ${extractedMessage}`.toLowerCase();
  if (status === 503 || lower.includes('unavailable') || lower.includes('high demand') || lower.includes('overloaded')) {
    return {
      status: 503,
      code: 'UNAVAILABLE',
      retryable: true,
      retryAfterSeconds: 5,
      userMessage:
        'Gemini AI is experiencing a temporary traffic spike (503). Automatic retries were attempted — please retry in a few seconds.',
    };
  }

  if (status === 429 || lower.includes('resource_exhausted') || lower.includes('quota') || lower.includes('rate limit')) {
    return {
      status: 429,
      code: 'RESOURCE_EXHAUSTED',
      retryable: true,
      retryAfterSeconds: 10,
      userMessage:
        'Gemini API rate limit or quota was temporarily reached (429). Please wait a few seconds and retry.',
    };
  }

  if (status === 403 || lower.includes('permission_denied') || lower.includes('api_key_invalid')) {
    return {
      status: 403,
      code: 'PERMISSION_DENIED',
      retryable: false,
      userMessage:
        'Gemini API rejected the server credentials (403). Verify GEMINI_API_KEY in server secrets.',
    };
  }

  if (
    status === 504 ||
    status === 502 ||
    lower.includes('deadline_exceeded') ||
    lower.includes('timeout') ||
    lower.includes('fetch failed') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout')
  ) {
    return {
      status: 503,
      code: 'TRANSIENT_NETWORK',
      retryable: true,
      retryAfterSeconds: 4,
      userMessage: 'Temporary connection issue reaching Gemini AI. Please retry in a moment.',
    };
  }

  if (status === 400 || lower.includes('invalid_argument')) {
    return {
      status: 400,
      code: 'INVALID_ARGUMENT',
      retryable: false,
      userMessage: 'Invalid request payload sent to Gemini AI.',
    };
  }

  return {
    status: status >= 400 && status <= 599 ? status : 502,
    code,
    retryable: false,
    userMessage: 'Unable to complete AI synthesis right now. Please try again.',
  };
}

export interface ResilientGenerateOptions {
  contents: string;
  config: Record<string, unknown>;
  models?: string[];
  maxAttemptsPerModel?: number;
  baseDelayMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

export interface ResilientGenerateResult<TResponse> {
  response: TResponse;
  modelUsed: string;
  attempts: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Executes `generateContent` with exponential backoff + jitter for transient 503/429 errors
 * and automatic failover from `gemini-4-hydrogen` to `gemini-3.1-flash-lite` during demand spikes.
 */
export async function generateContentWithRetry<TResponse extends { text?: string }>(
  invoke: (params: { model: string; contents: string; config: Record<string, unknown> }) => Promise<TResponse>,
  options: ResilientGenerateOptions
): Promise<ResilientGenerateResult<TResponse>> {
  const models = options.models ?? ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
  const maxAttemptsPerModel = Math.max(1, options.maxAttemptsPerModel ?? 2);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 600);
  const sleep = options.sleepFn ?? defaultSleep;

  let totalAttempts = 0;
  let lastError: unknown = null;

  for (let mIdx = 0; mIdx < models.length; mIdx += 1) {
    const model = models[mIdx];

    // Adapt thinkingConfig cleanly per model compatibility rules
    const adaptedConfig: Record<string, unknown> = { ...options.config };
    if (model === 'gemini-3.1-flash-lite') {
      adaptedConfig.thinkingConfig = { thinkingLevel: ThinkingLevel.MINIMAL };
    }

    for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt += 1) {
      totalAttempts += 1;
      try {
        const response = await invoke({
          model,
          contents: options.contents,
          config: adaptedConfig,
        });
        return { response, modelUsed: model, attempts: totalAttempts };
      } catch (err) {
        lastError = err;
        const parsed = parseGeminiApiError(err);
        if (!parsed.retryable) {
          throw err;
        }
        const hasMoreAttemptsThisModel = attempt < maxAttemptsPerModel;
        const hasFallbackModel = mIdx < models.length - 1;
        if (hasMoreAttemptsThisModel || hasFallbackModel) {
          const delay = Math.round(baseDelayMs * Math.pow(2, attempt - 1));
          if (delay > 0) {
            await sleep(delay);
          }
        }
      }
    }
  }

  throw lastError ?? new Error('Gemini request failed after retries.');
}
