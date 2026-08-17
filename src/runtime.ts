/** Runtime version contract shared by the dependency-free launcher and diagnostics. */
export const MIN_NODE = [22, 12, 0] as const;

export function runtimeIsSupported(version: string): boolean {
  const parts = version.split('.').map((part) => Number(part));
  for (let i = 0; i < MIN_NODE.length; i++) {
    const actual = parts[i] ?? 0;
    const required = MIN_NODE[i]!;
    if (actual !== required) return actual > required;
  }
  return true;
}
