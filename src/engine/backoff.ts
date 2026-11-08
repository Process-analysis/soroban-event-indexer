/**
 * Calculates exponential backoff with full/decorrelated jitter.
 *
 * @param attempt 0-based attempt count
 * @param initialMs base backoff in milliseconds (default: 500)
 * @param maxMs maximum backoff ceiling in milliseconds (default: 30000)
 * @param jitterFactor fraction of delay to randomize [0.0, 1.0] (default: 0.25)
 */
export function calculateBackoff(
  attempt: number,
  initialMs: number = 500,
  maxMs: number = 30000,
  jitterFactor: number = 0.25,
): number {
  if (attempt < 0) attempt = 0;
  // Calculate exponential delay: initial * 2^attempt
  const exponential = initialMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, maxMs);

  // Apply deterministic or randomized jitter
  const jitterRange = capped * jitterFactor;
  const jitter = (Math.random() * 2 - 1) * jitterRange; // [-jitterRange, +jitterRange]

  return Math.max(initialMs, Math.round(capped + jitter));
}

/**
 * Promisified sleep helper.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
