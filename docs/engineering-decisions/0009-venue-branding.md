# ADR-0009: A business's profile and each venue's brand, with images in R2

Status: accepted, 31 October 2026; widened on 3 November 2026 to a business profile above each
venue's brand (ADR-0011). Reverses the plan's "no uploaded branding" decision of 30 October.

## Context

A guest should see the venue they are at, not HashiFi, so a venue needs its own name, logo, colours
and wording. Files do not belong in PostgreSQL, and a container's disk does not outlive it. Before
login a guest's phone reaches only the portal host, so nothing the portal shows can come from
another address.

## Decision

1. **A business profile, then each venue's brand.** A business has a name and a square logo,
   edited by its owner only. Its people see them at the head of the admin in place of HashiFi's
   mark; platform staff always see HashiFi's, with the business named in the scope switcher. A
   venue's brand (`venue_brands`: colours, background, wording, an optional logo) themes its captive
   portal, edited by the owner or a manager of that venue. A guest sees the venue's logo, else the
   business's, else HashiFi's default in `portal_settings`, which the platform owner edits. Printed
   cards and new voucher prefixes follow the voucher's venue.
2. **The admin stays HashiFi's.** A business changes no colours or layout in the admin, so every
   business gets the same readable screens and support can describe them; the portal's foot and
   the admin sidebar's foot keep a small HashiFi credit.
3. **Files in R2, keys in PostgreSQL.** The private `hashifi` bucket holds the files; the backups
   bucket stays backups only. `BrandStore` has an R2 implementation on Bun's S3 client and a disk
   one under `data/brand/`, so nobody needs a bucket to run HashiFi. R2 is required in production.
4. **Served from the portal's own origin.** `GET /api/guest/brand/:venueId/:file` streams through
   the API on the path the web already proxies, so a phone reaches it through the walled garden
   with no router change and ADR-0008's one host still holds. A file is named by its content, so it
   caches for good, and a replacement gets a new address.
5. **Nothing arrives as it was sent.** An upload is decoded, which refuses anything but JPEG, PNG or
   WebP (SVG can carry scripts), turned upright, stripped of metadata, resized and re-encoded as
   WebP, which keeps a logo's transparency. The limit is 8 MB, enforced while reading. Responses set
   their own type and `nosniff`.
6. **One view.** The Portal Pages preview renders the component guests get (`PortalView`), so it
   cannot show what the portal does not have.

## Evidence

`brand.integration.test.ts`: the default and its fallback, per-venue saves, re-encoding with
transparency kept and metadata gone, replacement, refused uploads, manager scope, public route
names, prefix and guest context. `brand-store.test.ts` checks the R2 store's signed requests
against a local S3-style server. Walked in a browser: upload, preview, guest page, printed card.

Against the real `hashifi` bucket on 31 October, with a key limited to it: an upload through the
API, served back from `/api/guest/brand/`, replaced, then removed, leaving the bucket empty. The same
key is refused at the backups bucket.

## What remains open

- **Production secrets:** the key reaches a deployment as Docker secrets (`R2_ACCESS_KEY_ID_FILE`,
  `R2_SECRET_ACCESS_KEY_FILE`) when HashiFi is deployed (M8).
- **Speed on a first load:** the API fetches each file from R2, about 800 ms from a laptop. Phones
  cache it for good afterwards; if venues feel the first load, a cache in front of the route fits.
