/**
 * Removes values that must never leave the process (docs/SECURITY.md): voucher codes and router
 * credentials (both are credentials), phone numbers, email addresses and MAC addresses. Applied
 * to every free-text string that reaches a sink or Sentry, such as an error message, which can
 * quote a RouterOS command (`=name=<voucher code>`) or a driver error.
 */
const PATTERNS: [RegExp, string][] = [
  // RouterOS API parameters and filters carrying credentials or voucher codes: =name=, ?name=,
  // =password=, … (a hotspot user's name is its voucher code). Also hides other names in
  // transcripts, such as interface names; the provisioning report keeps those.
  [/([=?](?:name|password|user|private-key|public-key|secret)=)[^\s=]+/gi, "$1[redacted]"],
  // key=value / key: value pairs for the same fields in console syntax or JSON.
  [
    /\b((?:password|passwd|secret|token|api[-_]?key|private[-_]?key|code|voucher(?:[-_]?code)?|username)["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi,
    "$1[redacted]",
  ],
  // Connection strings with credentials.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi, "$1[redacted]@"],
  [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, "[email]"],
  [/\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi, "[mac]"],
  // Tanzanian and international phone numbers: +255…, 255…, 0[67]…
  [/(?<![\w.])(?:\+?255|0)[67]\d{8}\b/g, "[phone]"],
  [/(?<![\w.])\+\d{10,14}\b/g, "[phone]"],
];

export function redact(text: string): string {
  return PATTERNS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}
