/** Error taxonomy per docs/design.ja/02_architecture.md section 2.9.4. */

/** User-caused error: CLI arguments, input files, front matter. Exit code 2. */
export class InputError extends Error {
  readonly exitCode = 2 as const;
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

/** Runtime error: renderer, browser, Docker, internal invariants. Exit code 1. */
export class RuntimeError extends Error {
  readonly exitCode = 1 as const;
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeError';
  }
}

export function exitCodeOf(err: unknown): number {
  if (err instanceof InputError || err instanceof RuntimeError) return err.exitCode;
  return 1;
}
