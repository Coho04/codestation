export interface PageSpec {
  readonly offset: number;
  readonly limit: number;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

export const emptyPage = <T>(spec: PageSpec): Page<T> => ({
  items: [],
  total: 0,
  offset: spec.offset,
  limit: spec.limit,
});
