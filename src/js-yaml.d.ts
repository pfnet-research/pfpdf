declare module 'js-yaml' {
  export interface Schema {}
  export const FAILSAFE_SCHEMA: Schema;
  export const JSON_SCHEMA: Schema;
  export function load(
    input: string,
    options?: { schema?: Schema; json?: boolean },
  ): unknown;
}
