/** A message to show for a caught failure, or `fallback` when it carries none. */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
