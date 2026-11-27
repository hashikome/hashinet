# ADR-0009: A business's profile and each venue's brand, with images in R2

Status: accepted, 31 October 2026; widened on 3 November 2026 to a business profile above each
venue's brand (ADR-0011), and on 28 November 2026 to a portal copied down from the platform to the
business to each venue, with the platform's themes. Reverses the plan's "no uploaded branding" decision of 30 October.

## Context

A guest should see the venue they are at, not HashiFi, so a venue needs its own name, logo, colours
and wording. Files do not belong in PostgreSQL, and a container's disk does not outlive it. Before
login a guest's phone reaches only the portal host, so nothing the portal shows can come from
another address.

## Decision

1. **A business profile, then each venue's portal.** A business has a name, an address and a
   square logo, changed by its owner and read by its business managers. Its people see the logo at
   the head of the admin in place of HashiNet's mark; platform staff always see HashiNet's, with the
   business named in the scope switcher. A venue's portal (`venue_portals`: two colours, the page it
   opens on, wording, terms and an optional logo) is changed by the owner or a manager of that
   venue. A guest sees the venue's logo, else the business's, else none. Voucher codes have no
   prefix (ADR-0008).
1a. **Copied down, not inherited** (28 November 2026). A portal is two colours (the page's and its
   button's; every other colour is worked out from them), the page it opens on, whether it shows a
   logo, its wording and its terms. HashiNet's team keeps the themes (named pairs of colours, one
   the default) and the content a new business starts with (`portal_settings`); a new business
   copies it, in the default theme's colours, into `business_portals`; a new venue copies its
   business's into `venue_portals`. A later change reaches only what is created after it, and
   Restore defaults copies from one level up. A portal keeps its colours, not a theme, so removing
   a theme changes nobody's. While a business has one venue, saving the venue's portal saves the
   business's too, so its second venue starts the same. The logo is not copied: a guest sees the
   venue's own, else the business's (the business profile), else none. A daily sweep removes
   stored files nothing references once they are an hour old (`BrandService.sweep`).
2. **The admin stays HashiFi's.** A business changes no colours or layout in the admin, so every
   business gets the same readable screens and support can describe them; the portal's foot and
   the admin sidebar's foot keep a small HashiFi credit.
3. **Files in R2, keys in PostgreSQL.** The private `hashifi` bucket holds the files; the backups
   bucket stays backups only. `BrandStore` has an R2 implementation on Bun's S3 client and a disk
   one under `data/brand/`, so nobody needs a bucket to run HashiFi. R2 is required in production.
4. **Served from the portal's own origin.** `GET /api/guest/brand/:ownerId/:file` streams through
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
names and guest context. `brand-store.test.ts` checks the R2 store's signed requests
against a local S3-style server. Walked in a browser: upload, preview, guest page, printed card.

Against the real `hashifi` bucket on 31 October, with a key limited to it: an upload through the
API, served back from `/api/guest/brand/`, replaced, then removed, leaving the bucket empty. The same
key is refused at the backups bucket.

## What remains open

- **Production secrets:** the key reaches a deployment as Docker secrets (`R2_ACCESS_KEY_ID_FILE`,
  `R2_SECRET_ACCESS_KEY_FILE`) when HashiFi is deployed (M8).
- **Speed on a first load:** the API fetches each file from R2, about 800 ms from a laptop. Phones
  cache it for good afterwards; if venues feel the first load, a cache in front of the route fits.
