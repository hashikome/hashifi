import type { PrismaClient } from "../database/client.js";

/** Codes sent to one person per window, whatever address asks. */
export const SIGN_IN_CODES_PER_WINDOW = 5;
export const SIGN_IN_CODE_WINDOW_MINUTES = 15;

/**
 * Takes one code from the person's budget, atomically; false when it is spent. Better Auth's
 * limits are per client address, so without this anyone with many addresses could fill a
 * staff member's inbox.
 */
export async function consumeSignInCode(db: PrismaClient, userId: string): Promise<boolean> {
  const window = `${SIGN_IN_CODE_WINDOW_MINUTES} minutes`;
  const rows = await db.$queryRaw<{ codes_sent: number }[]>`
    INSERT INTO sign_in_code_budgets (user_id, window_started_at, codes_sent)
    VALUES (${userId}::uuid, now(), 1)
    ON CONFLICT (user_id) DO UPDATE SET
      codes_sent = CASE
        WHEN sign_in_code_budgets.window_started_at < now() - ${window}::interval THEN 1
        ELSE sign_in_code_budgets.codes_sent + 1 END,
      window_started_at = CASE
        WHEN sign_in_code_budgets.window_started_at < now() - ${window}::interval THEN now()
        ELSE sign_in_code_budgets.window_started_at END
    RETURNING codes_sent`;
  const sent = rows[0]?.codes_sent ?? Number.POSITIVE_INFINITY;
  return sent <= SIGN_IN_CODES_PER_WINDOW;
}
