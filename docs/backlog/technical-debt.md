# Technical debt

Accepted compromises: what was accepted, why, and what would retire it.

| Item | Why accepted | Retired by |
| --- | --- | --- |
| `apps/web/lib/types.ts` is a hand-written, partly stale copy of API shapes (`Venue`, `Router`, `WifiUser`, `ActiveSession`) | The real contract is defined with the NestJS DTOs | M4: `@hashifi/types` covers every response; the file is deleted |
| Each admin page calls `fetch` with its own URL fallback | Replaced with the contract | M4: one API client module |
| The web is not served against the new API | The API's HTTP surface is the health endpoints until M4 | M4 |
