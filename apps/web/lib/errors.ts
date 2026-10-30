import { ApiRequestError } from "./api";

/**
 * A message to show for a caught failure, or `fallback` when it carries none. For a validation
 * failure, that names the first field the API refused.
 */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError && err.details !== null) {
    const [field, problem] = Object.entries(err.details)[0] ?? [];
    if (field && problem) return `${field}: ${problem}`;
  }
  return err instanceof Error && err.message ? err.message : fallback;
}
