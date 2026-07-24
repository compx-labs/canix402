import type { FastifyBaseLogger } from "fastify";

/**
 * Process-wide logger for non-request contexts (adapters, Redis, aggregators).
 * Set from `buildApp` so modules can emit structured pino logs without circular imports.
 */
let appLogger: FastifyBaseLogger | null = null;

const fallbackLogger = {
  info(obj: unknown, msg?: string) {
    if (typeof obj === "string") {
      console.log(obj);
      return;
    }
    console.log(msg ?? "", obj);
  },
  warn(obj: unknown, msg?: string) {
    if (typeof obj === "string") {
      console.warn(obj);
      return;
    }
    console.warn(msg ?? "", obj);
  },
  error(obj: unknown, msg?: string) {
    if (typeof obj === "string") {
      console.error(obj);
      return;
    }
    console.error(msg ?? "", obj);
  },
  debug(obj: unknown, msg?: string) {
    if (typeof obj === "string") {
      console.debug(obj);
      return;
    }
    console.debug(msg ?? "", obj);
  },
  child() {
    return fallbackLogger;
  }
} as unknown as FastifyBaseLogger;

export function setAppLogger(logger: FastifyBaseLogger): void {
  appLogger = logger;
}

export function getAppLogger(): FastifyBaseLogger {
  return appLogger ?? fallbackLogger;
}

/** Test helper — clears the process logger between suites. */
export function resetAppLoggerForTests(): void {
  appLogger = null;
}
