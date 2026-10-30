# Technical debt

Accepted compromises: what was accepted, why, and what would retire it.

| Item | Why accepted | Retired by |
| --- | --- | --- |
| The provisioning reports (`SetupReport`, `ProvisionReport`, readiness) are copied by hand in `provision-dialog.tsx`, `readiness-checklist.tsx` and `router-connection-test.tsx` | They are large internal shapes that change with provisioning | Moving them into `@hashifi/types` |
| A second setup or provision on a router already running one is not refused | Claiming the `provisioning` status needs a staleness rule, or a crash leaves the router stuck | A run lease with an expiry |
