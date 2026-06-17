export type MetaValue = string | number | boolean | null;

export interface ApiSuccess<TData> {
  data: TData;
  meta?: Record<string, MetaValue>;
}
