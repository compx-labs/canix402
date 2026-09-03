export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR"
  | "NOT_FOUND"
  | "SESSION_INVALID"
  | "SESSION_EXPIRED"
  | "SESSION_EXHAUSTED"
  | "SESSION_UNAVAILABLE"
  | "WATCH_INVALID"
  | "WATCH_EXPIRED"
  | "WATCH_UNAVAILABLE"
  | "WATCH_UNAUTHORIZED";

export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}
