# HashiFi design

> The visual system and tokens, written for DESIGN.md-aware tools. Tokens live in
> `apps/web/app/globals.css`; components use the roles, never raw colours.

## Overview

HashiFi has two surfaces. The **admin** is a working tool for owners and venue staff, used in short
checks and longer sessions on a laptop or a phone: quiet, flat and exact, with the product's own
data doing the talking. The **guest portal** is a single small page on a cheap phone on a slow link,
before the guest has internet: one job, one large field and one button.

The direction is **Hearth**, from Hashikome's bonfire. Hashikome is the Sukuma bonfire: presence,
gathering, conversation. HashiFi is the WiFi by that fire, and connecting is joining the circle. Mist
ground, white panels and midnight ink; ember only in the mark, the charts and the sign-in button.

## Colors

Role names are the shadcn tokens the components use. Brand colours: midnight `#0D1B2A`, ember
`#F59E2A`, sand `#F2E7D7`, mist `#E9ECF0`.

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| `background`, `sidebar` | `#f4f6f8` | `#0d1b2a` | Page ground; the sidebar sits on it |
| `card` | `#ffffff` | `#132538` | Panels |
| `popover` | `#ffffff` | `#1a2f45` | What floats |
| `foreground` | `#0d1b2a` | `#eef1f4` | Primary text |
| `muted-foreground` | `#4e5d6e` | `#9daec0` | Secondary text; reaches 4.5:1 on every surface |
| `muted`, `secondary` | `#edf0f3` | `#1a2f45` | Tone steps, neutral fills |
| `primary` | `#f59e2a` | `#f59e2a` | The filled button on the midnight sign-in screens, with `primary-foreground` midnight text (8.1:1). In the app the filled button is `foreground` with `background` text, so it inverts in dark mode |
| `ember` | `#a9530a` | `#f6ae52` | Ember as a small mark in charts and the logo. Ember itself is 2.1:1 on white, so never text |
| `accent` | `#e7ebf0` | `#1a2f45` | Pale area: the selected fill, hover |
| `destructive` | `#c4242a` | `#f2707a` | Failed or destructive: problems are red, never ember |
| `border` | `#dfe3e8` | `#22384f` | Panel edges |
| `input` | `#8a94a3` | `#7a8ca0` | Control edges, 3:1 on a panel |
| `ring` | `#a9530a` | `#f59e2a` | Focus |
| `chart-1` to `chart-5` | ember, slate, pale ember, midnight, pale slate | the same, lifted | One hue per chart; ember on the main series, deepened to `#c97412` in light for 3:1 |

Status has four meanings, defined once in `lib/status-pill.ts` (owner's decision, 4 November 2026):
green for done and working (online, serving, active, accepted, paid; `#1d7a45` light, `#5fd08f`
dark), amber-yellow for waiting on something (setting up, not connected yet, invited, waiting;
`#8a6a00` text on a `#f4c430` tint, `#f2cf5b` dark), red for what needs a human or has ended
(offline, failed, expired, revoked), and neutral for everything else. Ember is the brand and the
action colour, never a status, so a status never reads as a button or a live figure. Each status
text meets 4.5:1 on its panel in both themes.

The dark theme is midnight, not a neutral dark: a deliberate exception to the usual rule, because
midnight is the brand's night.

Each venue can set its own colours, logo and background (ADR-0009), with HashiFi's defaults of ember
on a midnight field. Text colours are computed from them, so any choice stays readable, and a
background photo sits under a 55% black scrim.

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
  aligned. Monospace only for voucher codes, IDs and keys, in JetBrains Mono, self-hosted beside
  Figtree, so a code looks the same on every device and on paper.

## The name in copy

Hashifi, capitalised, in sentences and labels. Lower case only where it is the mark or a name in a
system: the wordmark, "Runs on hashifi", the portal's signature, the automatic actor in logs, domains,
addresses and file names.

## Order in lists

- **Filters** run Search, then business, venue and region, then kind or role, then status, then dates.
- **Columns** read as a sentence about the row: its subject, then the subject's own details, numbers
  included, then what it belongs to, business, venue, then router, and any action last. "Router x running
  RouterOS 7.25 is online with 6 devices, at business y's venue." The word is always Status.
- A parent or a place is a column, never a line under the row's name; a model, an owner or an email can
  stay there. Area is a column, and Region one only where the venues in view differ by it. Cards, lines and subtitles follow the same order, with the business and venue last.
- Every filter has a column to see it in, and both go where they cannot tell anything apart: Business
  is for the platform alone, Venue for someone with more than one venue in view, and a filter whose
  rows hold only one value is left out. A screen shows the same columns in every scope, less what a
  role may not see; a platform operator has no Payments, so no money appears anywhere for them.

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
- **A picture beside a name and a second line** (avatar, business logo, workspace) is exactly as tall
  as the two lines: 32px, for 17px and 15px lines.
- **Placeholders are sample inputs** (`Amina Salum`, `Mjimwema, Kigamboni`), never instructions;
  guidance goes in the hint under the field.
- **Empty states:** keep the frame and say one sentence. A real zero prints as a zero, and a missing
  value as a grey dash.

- **Mark:** the open ring with the ember in its gap, with no wordmark (owner's decision, 4 November
  2026). In the platform workspace a solid `PLATFORM` tag sits beside it, the text colour as its
  ground so it inverts in dark mode, telling the platform apart from a business that uses the ring. `HashifiMark` draws it in the admin, the ring in
  the text colour, with `aria-label="hashifi"`; `public/logo.svg` and the icons are the same mark on a
  midnight tile, for print and for any surface. A business workspace shows the business's logo and
  name instead.
- **Name:** written `hashifi`, lowercase, everywhere a person reads it, including the start of a
  sentence, as ntumie. is. Never "HashiFi".

## Do's and Don'ts

- Do put ember in the mark, the charts and the sign-in screens' button, and nowhere else (owner's
  decision, 5 November 2026). Links, figures and counts are plain ink, so a link is always underlined
  (a row that opens on click and a button are not links and carry none).
- Do show selected one way everywhere, quietly: the `accent` fill with `foreground` text at 600 (a
  menu item, a range button on white), a 1px `foreground` edge with no fill (a card), or a
  `foreground` mark (a tab's underline, a tick). The current step of a checklist has no fill: its number
  is ringed in `foreground` and the steps still to come step back (outlined numbers, secondary ink). Selected is never louder than the page's action (owner's decision, 5 November 2026, after
  ember text, a warm tint and inverted midnight were tried). A card is its own control, with no
  radio dot.
- Do frame a needs-you banner with the same 1px `foreground` edge as a selected card; its words and
  pills carry how serious it is, never a red or ember frame.
- Do keep status pills quiet and smaller than the text beside them: 11.5px on a tint, no outline, no dot (the word
  and its colour say it), and text that reaches 4.5:1 against the tint itself, in both themes.
- Do keep counts neutral, the Issues count included: red is for a status pill, not a badge.
- Do give a figure one number and only the context that adds to it: "6" routers online, "1 offline"
  below; never "6/7" or "of 7".
- Do use a role, never a raw colour; a new need is a new role here first.
- Don't use cream with terracotta, violet or indigo, a tinted sidebar, gradients, glows,
  glass, or a shadow on anything at rest.
- Don't add a typeface or a fifth status hue.
- Don't fetch anything from another host on the guest portal.
