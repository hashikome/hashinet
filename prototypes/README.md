# prototypes/

Where screens, flows and design are worked out in plain HTML before the expensive implementation,
and how an approved prototype becomes the product. The same in every Hashikome product. Everything
here except this README is ignored by git.

## Building a prototype

- **Start here.** New screens, flows, redesigns and design comparisons begin as a prototype. Build
  them only once the owner has approved it; what ships matches the prototype, and where it must
  differ the ExecPlan records why.
- **Plain HTML in a browser.** One folder per piece of work, `prototypes/<name>/`, opened from disk
  or served with `python3 -m http.server`. No build step and no product code.
- **One persona per role,** with realistic invented data: never secrets, personal data or production
  data.
- **Design and check each screen as you go.** Build it with design-build, audit it with design-audit,
  and test it in browser DevTools: phone and desktop widths, light and dark, states and
  interactions, and a clean console. A round of variants is compared with design-audit and chosen by
  the owner.
- **No artifacts.** Do not publish prototypes to claude.ai or anywhere else unless the owner
  explicitly asks.
- **Decisions leave here.** Git does not back this folder up, so record what was settled in
  `DESIGN.md`, an ADR or the ExecPlan. A prototype is never the only copy of a decision.

## The approval gate: a journey and role review

Before the owner approves the whole prototype, review it as the people who will use it:

- **Map the roles and their journeys** from `PRODUCT.md` and the roles ADR (ADR-0011): who does what, and what
  each role must never see or do.
- **Walk every persona** through every screen in their navigation, pressing every action. A dead
  control, a script error, a page without a title, a figure that disagrees with the same figure on
  another screen, or anything outside the persona's scope is a finding.
- **Follow the journeys that cross roles** end to end: one person's action and the next person's view
  of it (a sale and its confirmation, an invitation and its acceptance, an invoice and its payment).
- **Audit the interface** with design-audit and design-build's inspector across each role's main
  screens, comparing each surface with the screens it is reached from.
- **Review the logic** with code-review against `PRODUCT.md` and the ADRs: who may do or see what,
  what the owner or admin keeps, scoping, and whether figures add up across screens.
- Fix what the review finds here, record the rules it settled in the ExecPlan's Decision Log, then ask
  the owner to approve.

## From the approved prototype to the product

- **Vertical slices.** The build ships one complete journey at a time that a real person can rely on:
  schema, API, screens and live acceptance, through the normal release path, each accepted live
  before the next. Order slices by journey, never by layer, starting with the smallest journey
  someone uses for real.
- **One slice plan** ([build-in-slices.md](../docs/exec-plans/active/build-in-slices.md)) sets the order and each slice's acceptance; the detailed plans it
  relies on keep their detail and say the slice plan orders them.
- **Resumable steps.** Each slice is a list of steps, each ending with `bun run verify` passing and a
  commit: schema; the API with its tests; the screens; removing what the slice replaced;
  finish-work; merge, push and live acceptance.
- **Screens are audited as they are built:** design-build for each screen against its prototype, then
  design-audit at desktop and phone widths in light and dark, its P0 and P1 fixed before the next
  screen.
- **finish-work at the end of every slice,** on its branch before the merge: code review, security
  review, simplification, the journey-level design audit across the slice's screens, docs, CHANGELOG
  and the handbook. The last slice's run also completes the slice plan.
- **Local branches.** Each slice is built on a local branch (`slice-<n>`) that is never pushed and has
  no pull request. When it passes: `git switch main && git merge --ff-only slice-<n>`, then push `main`
  with the owner's go. Every push to `main` releases, so `main` stays releasable.
- **No backward compatibility before there are users** (`AGENTS.md`, Pre-deployment compatibility): a
  slice deletes what it replaces in the same change and never runs old and new side by side. A
  fresh baseline that drops a deployed database is its own owner-run step, just before the deploy
  that needs it: back up, reset, deploy, bootstrap only the first admin, then set up again whatever
  the reset disconnects.
- The plan records separately for each slice: implemented and verified locally, published,
  deployed, and accepted live.
