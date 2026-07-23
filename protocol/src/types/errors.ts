export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR"
  | "NOT_FOUND"
  | "STRATEGY_VALIDATION_ERROR"
  | "STRATEGY_NOT_FOUND"
  | "STRATEGY_FORBIDDEN"
  | "STRATEGY_CONFLICT";

export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}
