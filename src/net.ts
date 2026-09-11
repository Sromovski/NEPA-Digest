/**
 * Hard wall-clock timeout for a promise.
 *
 * rss-parser's own `timeout` option covers the initial response but not every
 * way a request can stall (slow trickling bodies, redirect loops). The digest
 * fans out over every source with Promise.allSettled, so a single feed that
 * never settles would hang the whole run — and the scheduler would sit there
 * until the next cron fired. Every network call in the pipeline goes through
 * this so a bad source can only ever cost us `ms`.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: NodeJS.Timeout;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${label}`)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}
