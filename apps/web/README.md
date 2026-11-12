# @hashinet/web

HashiNet's web: sign-in and invitations, the signed-in dashboard (a business's Overview, Vouchers,
Payments, Packages and its routers; HashiNet's team's Businesses), Account and security, Help, and
the guest's captive portal (`/join`). All data comes from `@hashinet/api`; the API's JSON contract
is `@hashinet/types`.

## Commands

From the repository root (`bun run verify` runs everything CI runs), or here:

| Command | What it does |
| --- | --- |
| `bun run dev` | Development server on port 3006 |
| `bun run build` | Production build, including the type check |
| `bun run typecheck` | `tsc --noEmit` |

Copy `.env.example` to `.env.local`. Port 3006 matches the API's default `FRONTEND_ORIGIN`
for CORS and for passkeys.

## Conventions

- **The prototype is the reference.** Screens are built from `prototypes/hearth-design/prototype/`;
  `app/hearth.css` is its stylesheet, and `components/hearth/` its building blocks (`Head`, `Panel`,
  `Table`, `Figs`, `Dialog`, `OtpBoxes`, the shell). Check there before writing a new one.
- **The API decides; the web presents** ([ADR-0003](../../docs/engineering-decisions/0003-api-owns-logic-web-presents.md)).
  The menu and buttons come from `/api/me`'s `capabilities` (`useCan`), never from the role.
- **One client:** `lib/api.ts`; a page loads with `useLoad`, and a failed load shows `LoadFailed`
  with Try again, never an empty state.
- **Money is whole shillings:** `tsh()`. **Dates** through `lib/dates.ts`, in Dar es Salaam time.
- **Voucher codes** are 12 digits, shown in three groups and set in JetBrains Mono.
- **Every button that hits the network shows it is busy and disables** (`Button busy`).
- **Confirmations are `Dialog alert`**, with Cancel focused, never `window.confirm()`.
- **The theme** is the person's (`/api/me`), applied before the first paint (`lib/theme.ts`);
  signed-out pages are always dark.
- Fonts are self-hosted (`public/fonts/`, OFL-1.1).
