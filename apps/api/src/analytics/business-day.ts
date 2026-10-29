import { Prisma } from "../generated/prisma/client.js";

/**
 * HashiFi stores instants in UTC and reports by the business's calendar: a day in
 * Africa/Dar_es_Salaam (UTC+3, no daylight saving) runs from 21:00 UTC to 21:00 UTC. Both the
 * database grouping and the application use this zone name, never a fixed offset.
 */
export const BUSINESS_TIME_ZONE = "Africa/Dar_es_Salaam";

/** The business day of `column` (a timestamptz), for GROUP BY and WHERE in raw SQL. */
export function businessDaySql(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(${column} AT TIME ZONE ${BUSINESS_TIME_ZONE})::date`;
}

/** The business day of an instant, as YYYY-MM-DD. */
export function businessDayOf(instant: Date): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}
