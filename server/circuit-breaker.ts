// Wraps an async function in an opossum circuit breaker with our logger
// + Sentry hooks on state transitions. Once the circuit opens, calls
// fast-fail for resetTimeout ms before the half-open probe — protects
// upstream services AND lets the agent abandon a flaky tool quickly
// instead of looping retries that all time out.
//
// Defaults are tuned for external HTTP APIs (Dune, DefiLlama, Voyage):
//   - 30s call timeout      — anything slower is treated as a failure
//   - 50% error threshold   — over the rolling window
//   - 5 call volume         — don't trip on a single early error
//   - 30s reset timeout     — how long the circuit stays open before
//                             allowing one probe call through
import CircuitBreaker from "opossum";
import { logger } from "./logger";
import { Sentry, sentryEnabled } from "./sentry";

export function wrapInCircuit<TArgs extends any[], TResult>(
  name: string,
  fn: (...args: TArgs) => Promise<TResult>,
  opts: Partial<CircuitBreaker.Options> = {},
): (...args: TArgs) => Promise<TResult> {
  const breaker = new CircuitBreaker(fn, {
    timeout: 30_000,
    errorThresholdPercentage: 50,
    resetTimeout: 30_000,
    volumeThreshold: 5,
    name,
    ...opts,
  });

  breaker.on("open", () => {
    logger.error({ breaker: name, state: "open" }, "circuit-breaker.opened");
    if (sentryEnabled) {
      Sentry.captureMessage(`Circuit breaker opened: ${name}`, "warning");
    }
  });
  breaker.on("halfOpen", () => {
    logger.warn({ breaker: name, state: "halfOpen" }, "circuit-breaker.half-open");
  });
  breaker.on("close", () => {
    logger.info({ breaker: name, state: "closed" }, "circuit-breaker.closed");
  });

  return ((...args: TArgs) => breaker.fire(...args) as Promise<TResult>);
}
