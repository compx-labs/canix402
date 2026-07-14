export interface ThrottleOptions {
  concurrency: number;
  delayMs: number;
}

export interface RequestGate {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

/**
 * Shares a bounded request budget across otherwise independent call paths.
 * Unlike mapWithThrottle, callers can enqueue work incrementally, which makes
 * it suitable for SDK calls that are discovered while protocol collectors run.
 */
export function createRequestGate(options: ThrottleOptions): RequestGate {
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const delayMs = Math.max(0, Math.floor(options.delayMs));
  const queue: Array<{
    operation: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }> = [];
  let active = 0;
  let nextStartAt = Date.now();
  let wakeUp: ReturnType<typeof setTimeout> | undefined;

  const drain = (): void => {
    if (active >= concurrency || queue.length === 0) {
      return;
    }

    const now = Date.now();
    const startAt = Math.max(now, nextStartAt);
    if (startAt > now) {
      if (wakeUp === undefined) {
        wakeUp = setTimeout(() => {
          wakeUp = undefined;
          drain();
        }, startAt - now);
      }
      return;
    }

    const entry = queue.shift();
    if (entry === undefined) {
      return;
    }
    active += 1;
    nextStartAt = startAt + delayMs;
    void entry
      .operation()
      .then(entry.resolve, entry.reject)
      .finally(() => {
        active -= 1;
        drain();
      });
    drain();
  };

  return {
    run<T>(operation: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push({
          operation,
          resolve: (value) => resolve(value as T),
          reject
        });
        drain();
      });
    }
  };
}

/**
 * Wraps an Algod client so every SDK `.do()` request consumes the supplied
 * request budget. This lets third-party SDKs participate without rewriting
 * their internal request paths.
 */
export function withAlgodRequestGate(
  algod: object,
  gate: RequestGate
): object {
  return new Proxy(algod, {
    get(target, property) {
      const member = Reflect.get(target, property, target);
      if (typeof member !== "function") {
        return member;
      }
      return (...args: unknown[]) => {
        const result = member.apply(target, args);
        if (
          typeof result !== "object" ||
          result === null ||
          !("do" in result) ||
          typeof result.do !== "function"
        ) {
          return result;
        }
        return new Proxy(result, {
          get(request, requestProperty) {
            const requestMember = Reflect.get(
              request,
              requestProperty,
              request
            );
            if (requestProperty === "do" && typeof requestMember === "function") {
              return (...requestArgs: unknown[]) =>
                retryRateLimited(
                  () =>
                    gate.run(() => requestMember.apply(request, requestArgs)),
                  {
                    maxRetries: readNonNegativeInteger(
                      process.env.ALGOD_429_MAX_RETRIES,
                      2
                    ),
                    baseDelayMs: readNonNegativeInteger(
                      process.env.ALGOD_429_RETRY_BASE_MS,
                      250
                    ),
                    getStatus: extractHttpStatus
                  }
                );
            }
            return typeof requestMember === "function"
              ? requestMember.bind(request)
              : requestMember;
          }
        });
      };
    }
  });
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

function extractHttpStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

function readNonNegativeInteger(
  value: string | undefined,
  fallback: number
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
