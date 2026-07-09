export type ExecutionErrorCode =
  | "SHAPE_NOT_FOUND"
  | "INVALID_SHAPE_INPUT"
  | "SHAPE_STATE_UNAVAILABLE"
  | "SHAPE_BUILD_FAILED"
  | "SHAPE_VALIDATION_FAILED";

export class ExecutionError extends Error {
  public readonly code: ExecutionErrorCode;
  public readonly details?: unknown;
  public readonly cause?: unknown;

  public constructor(
    code: ExecutionErrorCode,
    message: string,
    options?: { details?: unknown; cause?: unknown }
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (options?.details !== undefined) {
      this.details = options.details;
    }
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export class ShapeNotFoundError extends ExecutionError {
  public constructor(key: string) {
    super("SHAPE_NOT_FOUND", `No transaction shape registered for key "${key}".`, {
      details: { key }
    });
  }
}

export class InvalidShapeInputError extends ExecutionError {
  public constructor(message: string, details?: unknown) {
    super("INVALID_SHAPE_INPUT", message, details === undefined ? undefined : { details });
  }
}

export class ShapeStateError extends ExecutionError {
  public constructor(message: string, options?: { details?: unknown; cause?: unknown }) {
    super("SHAPE_STATE_UNAVAILABLE", message, options);
  }
}

export class ShapeBuildError extends ExecutionError {
  public constructor(message: string, options?: { details?: unknown; cause?: unknown }) {
    super("SHAPE_BUILD_FAILED", message, options);
  }
}

export class ShapeValidationError extends ExecutionError {
  public constructor(message: string, details?: unknown) {
    super(
      "SHAPE_VALIDATION_FAILED",
      message,
      details === undefined ? undefined : { details }
    );
  }
}
