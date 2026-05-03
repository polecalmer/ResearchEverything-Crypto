// p-retry wrapper that hooks into our logger + Sentry on attempt failures
// and exhaustion. Use this around any external-dependency call where a
// transient failure (network blip, 429, 5xx) shouldn't surface to the
// caller on first try.
//
// Defaults: 4 attempts (1 initial + 3 retries), exponential backoff
// 500ms -> 1s -> 2s with jitter, capped at 5s. Tunable via opts.
import pRetry from "p-retry";
import { logger } from "./logger";
import { Sentry, sentryEnabled } from "./sentry";

type RetryOptions = NonNullable<Parameters<typeof pRetry>[1]>;

export async function retryWithBackoff<T>(
  label: string,
  fn: (attemptCount: number) => Promise<T>,
  opts: Partial<RetryOptions> = {},
): Promise<T> {
  try {
    return await pRetry(fn, {
      retries: 3,
      minTimeout: 500,
      maxTimeout: 5_000,
      factor: 2,
      randomize: true,
      onFailedAttempt: (ctx) => {
        logger.warn(
          {
            label,
            attempt: ctx.attemptNumber,
            retriesLeft: ctx.retriesLeft,
            err: ctx.error.message,
          },
          "retry.attempt-failed",
        );
      },
      ...opts,
    });
  } catch (err: any) {
    logger.error({ label, err }, "retry.exhausted");
    if (sentryEnabled) {
      Sentry.captureException(err, { tags: { retry_label: label } });
    }
    throw err;
  }
}
