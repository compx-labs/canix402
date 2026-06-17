export interface ApiResponse<TData> {
  data: TData;
  meta?: Record<string, string | number | boolean | null>;
}
