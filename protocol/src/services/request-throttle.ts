export interface ThrottleOptions {
  concurrency: number;
  delayMs: number;
}

/**
 * Runs work with bounded concurrency and a minimum delay between task starts.
 * The delay prevents public RPC providers from receiving a burst even when
 * several workers are active.
 */
export async function mapWithThrottle<T>(
  items: readonly T[],
  options: ThrottleOptions,
  worker: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const delayMs = Math.max(0, Math.floor(options.delayMs));
  let nextStartAt = Date.now();

  const runners = Array.from(
    { length: Math.min(concurrency, queue.length) },
    async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item === undefined) {
          return;
        }

        const now = Date.now();
        const startAt = Math.max(now, nextStartAt);
        nextStartAt = startAt + delayMs;
        if (startAt > now) {
          await sleep(startAt - now);
        }
        await worker(item);
      }
    }
  );

  await Promise.all(runners);
}

export async function retryRateLimited<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries: number;
    baseDelayMs: number;
    getStatus: (error: unknown) => number | undefined;
  }
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (options.getStatus(error) !== 429 || attempt >= options.maxRetries) {
        throw error;
      }
      await sleep(options.baseDelayMs * 2 ** attempt);
      attempt += 1;
    }
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
