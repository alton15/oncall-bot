import { logger } from "./logger.js";

const log = logger.create("retry");

export interface RetryOptions {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: unknown) => boolean;
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { maxAttempts, delayMs, backoffMultiplier = 2, shouldRetry } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;

      if (attempt === maxAttempts) break;
      if (shouldRetry && !shouldRetry(err)) break;

      const waitMs = delayMs * Math.pow(backoffMultiplier, attempt - 1);
      log.warn(`Attempt ${attempt}/${maxAttempts} failed, retrying in ${waitMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  throw lastError;
}
