# Reliability

## Data integrity

PostgreSQL is authoritative. Schema changes are reviewed migrations applied by
`bun run db:migrate`; an applied migration is never edited.

## Jobs and retries

Background work is idempotent and safe to retry; a retry never repeats an effect that
already happened.

## Releases and recovery

> How a release is verified, rolled back and recovered, and where backups live.
