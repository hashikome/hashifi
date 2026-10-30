# ADR-0009: Each venue's brand, with images in R2

Status: accepted, 31 October 2026. Reverses the plan's "no uploaded branding" decision of 30 October.

## Context

A guest should see the venue they are at, not HashiFi, so a venue needs its own name, logo, colours
and wording. Files do not belong in PostgreSQL, and a container's disk does not outlive it. Before
login a guest's phone reaches only the portal host, so nothing the portal shows can come from
another address.

## Decision

1. **Per venue, with a default.** `venue_brands` holds a venue's brand; no row means it shows the
   HashiFi default in `portal_settings`, whose logo ships with the web. An admin edits the default.
   A manager brands the venues they operate, and any other venue is not found. Printed cards and
   new voucher prefixes follow the voucher's venue.
2. **Files in R2, keys in PostgreSQL.** The private `hashifi` bucket holds the files; the backups
   bucket stays backups only. `BrandStore` has an R2 implementation on Bun's S3 client and a disk
   one under `data/brand/`, so nobody needs a bucket to run HashiFi. R2 is required in production.
3. **Served from the portal's own origin.** `GET /api/guest/brand/:venueId/:file` streams through
   the API on the path the web already proxies, so a phone reaches it through the walled garden
   with no router change and ADR-0008's one host still holds. A file is named by its content, so it
   caches for good, and a replacement gets a new address.
4. **Nothing arrives as it was sent.** An upload is decoded, which refuses anything but JPEG, PNG or
   WebP (SVG can carry scripts), turned upright, stripped of metadata, resized and re-encoded as
   WebP, which keeps a logo's transparency. The limit is 8 MB, enforced while reading. Responses set
   their own type and `nosniff`.
5. **One view.** The Portal Pages preview renders the component guests get (`PortalView`), so it
   cannot show what the portal does not have.

## Evidence

`brand.integration.test.ts`: the default and its fallback, per-venue saves, re-encoding with
transparency kept and metadata gone, replacement, refused uploads, manager scope, public route
names, prefix and guest context. `brand-store.test.ts` checks the R2 store's signed requests
against a local S3-style server. Walked in a browser: upload, preview, guest page, printed card.

## What remains open

- **R2 itself is unproved** until the bucket has a key: nothing has yet run against the real service.
