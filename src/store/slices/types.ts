export interface SliceDefinition<T extends Record<string, unknown>> {
  name: string;
  initialState: Partial<T>;
  creator: (set: Function, get: Function) => Record<string, unknown>;
}
