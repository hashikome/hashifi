# HashiFi design

> The visual system and tokens, written for DESIGN.md-aware tools. **Provisional:** these are
> foundations, not the brand. A dedicated session will redesign the brand, starting from these
> roles. Tokens live in `apps/web/app/globals.css`; components use the roles, never raw colours.

## Overview

HashiFi has two surfaces. The **admin** is a working tool for owners and venue staff, used in short
checks and longer sessions on a laptop or a phone: quiet, flat and exact, with the product's own
data doing the talking. The **guest portal** is a single small page on a cheap phone on a slow link,
before the guest has internet: one job, one large field and one button.

The style is `accent-ladder` on an open-plane shell: one hue at full strength only on small marks
(the primary button, data, the active nav icon) and its pale tints on areas. It is built from the
teal already in the portal's settings.

## Colors

Role names are the shadcn tokens the components use.

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| `background`, `sidebar` | `#f9fafb` | `#111111` | Page ground; the sidebar sits on it |
| `card` | `#ffffff` | `#181818` | Panels |
| `popover` | `#ffffff` | `#202020` | What floats |
| `foreground` | `#111827` | `#f5f5f5` | Primary text |
| `muted-foreground` | `#5f6672` | `#b4b4b4` | Secondary text; reaches 4.5:1 on every surface |
| `muted`, `secondary` | `#f3f4f6` | `#222222` | Tone steps, neutral fills |
| `primary` | `#0f766e` | `#2dd4bf` | The one filled button, data, active marks |
| `accent` | `#f0fdfa` | `#12302d` | Pale tint for areas: active nav, hover |
| `accent-foreground` | `#134e4a` | `#99f6e4` | Text on the tint |
| `positive` | `#0f766e` | `#2dd4bf` | Good and online: the same hue, so there is no second green |
| `warning` | `#92400e` | `#f5b454` | Needs attention |
| `destructive` | `#c4242a` | `#e5566f` | Failed or destructive |
| `border` | `#e5e7eb` | `#2e2e2e` | Panel edges |
| `input` | `#868d9a` | `#7a7a7a` | Control edges, 3:1 on a panel |
| `chart-1` to `chart-5` | teal, grey, pale teal, amber, pale grey | the same, lifted | One hue per chart; teal on the main series |

Status pills are a pale wash with dark text of the same hue (`lib/status-pill.ts`): teal, amber, red
and neutral grey. Amber and red are the only other hues; neither is decoration.

Each venue can set its own colours, logo and background (ADR-0009), with HashiFi's defaults of
`#0F766E` on a `#134E4A` field. Text colours are computed from them, so any choice stays readable,
and a background photo sits under a 55% black scrim.

## Typography

- **Figtree everywhere:** the admin, the guest portal and the router's pages. A variable font
  (OFL-1.1) committed at `apps/web/public/fonts/` and loaded through `next/font/local`, about 20 KB,
  so every phone sees the same page and no request goes to a third party. Weights 400 to 700.
  Chosen by measurement: it has true tabular figures, which DM Sans does not.
- **Never a system font by design.** One exists only as the metric-adjusted fallback if the file
  fails to load.
- **Sizes:** page title 24px, section 18px, figure 24px, body 14px, small 12px; nothing under 11px.
  On a phone the portal's body is 16px, so browsers do not zoom on focus.
- Sentence case, no tracked capitals. Tabular figures on every number in a table or figure, right
  aligned. Monospace only for voucher codes, IDs and keys.

## Elevation

Flat. A panel is a 1px `border` on the ground, and nothing at rest has a shadow. Only what truly
floats (a menu, a popover, a dialog) casts one. In dark mode elevation is lightness.

Radius is one tight scale: chips 4px, controls 6px, panels and dialogs 8px, pills full. Spacing is a
4px base: one 24px gap between panels, 24px panel padding, 32px control height, 45px table rows, a
230px sidebar. Motion is feedback only (press, hover, focus, a menu opening), about 150ms, and
respects `prefers-reduced-motion`.

## Components

- **Buttons:** one filled primary per screen; secondary is outlined; tertiary is text.
- **Sidebar:** on the page ground, with the product's mark and name at the top. The active item is
  the pale tint with dark ink. Below 768px it folds into a 48px bar and a sheet.
- **Figures:** type, not tiles: a label over a value, with no tinted icon.
- **Tables:** rules and alignment; no zebra, no header band, no uppercase headers.
- **Empty states:** keep the frame and say one sentence. A real zero prints as a zero, and a missing
  value as a grey dash.

- **Mark:** an H whose crossbar is a WiFi arc with its dot, white on teal; one file
  (`public/logo.svg`) at every size.

## Do's and Don'ts

- Do put colour on data, status and the one primary action.
- Do use a role, never a raw colour; a new need is a new role here first.
- Don't use cream with terracotta, violet or indigo, a dark or tinted sidebar, gradients, glows,
  glass, or a shadow on anything at rest.
- Don't add a typeface or a third status hue.
- Don't fetch anything from another host on the guest portal.
