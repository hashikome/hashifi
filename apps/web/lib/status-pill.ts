/**
 * One palette for every status pill in the admin UI.
 *
 * This exists because the same six semantic states were spelled out independently on the
 * routers, payments, venues, sessions, vouchers, team, users and packages pages, and no
 * two agreed. The failures that produced were all the same shape:
 *
 *   • `text-teal-700` with no `dark:` counterpart — a dark green on a dark chip,
 *     which is what made the Team page's "Active" unreadable in dark mode.
 *   • `border-teal-200` — a near-white hairline that reads as a light outline ring
 *     once the page behind it is dark.
 *   • `text-*-600` on one page and `text-*-700` on the next for the same status.
 *
 * Each tone is defined once, for both themes:
 *   light — a 12% wash of the hue, 700-weight text (≥4.7:1 on a white card)
 *   dark  — a 15% wash, 300-weight text (≥7:1 on the dark card)
 * plus an inset ring rather than a border, so the chip has an edge in both themes without
 * a light-mode hairline surviving into dark mode.
 *
 * Pass the result as `className` on a `<Badge>`; tailwind-merge drops the variant's own
 * background and text colour in favour of these.
 */
export const statusPill = {
  /** Working as intended — online, active, paid, connected. */
  success:
    "bg-teal-500/12 text-teal-700 ring-1 ring-inset ring-teal-600/20 " +
    "dark:bg-teal-400/15 dark:text-teal-300 dark:ring-teal-400/25",

  /** In progress, or fine but worth noticing — provisioning, pending, maintenance. */
  warning:
    "bg-amber-500/12 text-amber-700 ring-1 ring-inset ring-amber-600/20 " +
    "dark:bg-amber-400/15 dark:text-amber-300 dark:ring-amber-400/25",

  /** Needs a human — failed, terminated, error. */
  danger:
    "bg-red-500/12 text-red-700 ring-1 ring-inset ring-red-600/20 " +
    "dark:bg-red-400/15 dark:text-red-300 dark:ring-red-400/25",

  /** Finished, neutral-good — a spent voucher, a closed session. */
  info:
    "bg-zinc-500/12 text-zinc-700 ring-1 ring-inset ring-zinc-600/20 " +
    "dark:bg-zinc-400/15 dark:text-zinc-300 dark:ring-zinc-400/25",

  /** Waiting on something external — the router hasn't confirmed yet. */
  accent: "bg-accent text-accent-foreground ring-1 ring-inset ring-primary/20",
  neutral:
    "bg-muted text-muted-foreground ring-1 ring-inset ring-border " +
    "dark:bg-muted dark:text-muted-foreground",
} as const;

export type StatusTone = keyof typeof statusPill;
