/**
 * Retry-with-backoff for operations that can fail transiently.
 *
 * Deliberately duck-types `retryable` rather than importing the RouterOS error taxonomy,
 * so this stays usable for any caller (SMTP, Snippe, …) without coupling.
 */

export interface RetryOptions {
  /** Total attempts including the first. Default 3. */
  attempts?: number;
  /** Delay before attempt N+1. Last value repeats if attempts exceed the array. */
  backoffMs?: number[];
  /** Decide whether an error is worth retrying. Default: `err.retryable === true`. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Called before each retry — use it to log the attempt. */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

const DEFAULT_BACKOFF = [500, 2000];

function defaultShouldRetry(err: unknown): boolean {
  return (err as { retryable?: boolean } | null)?.retryable === true;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF;
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;

  let lastErr: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      const isLast = attempt === attempts;
      if (isLast || !shouldRetry(err, attempt)) throw err;

      const delay = backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0;
      opts.onRetry?.(err, attempt, delay);
      await sleep(delay);
    }
  }

  throw lastErr;
}
