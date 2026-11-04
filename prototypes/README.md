# prototypes/

Where screens and design are worked out in plain HTML, before the expensive implementation. The
same in every Hashikome product. Everything here except this README is ignored by git.

- **Start here.** New screens, flows, redesigns and design comparisons begin as a prototype. Build
  them only once the owner has approved it; what ships matches the prototype.
- **Plain HTML in a browser.** One folder per piece of work, `prototypes/<name>/`, opened from disk
  or served with `python3 -m http.server`. No build step and no product code.
- **Check as you go.** Test each view in browser DevTools while building it: phone and desktop
  widths, light and dark, states and interactions, and a clean console.
- **Realistic, invented data.** Never secrets, personal data or production data.
- **No artifacts.** Do not publish prototypes to claude.ai or anywhere else unless the owner
  explicitly asks.
- **Decisions leave here.** Git does not back this folder up, so record what was settled in
  `DESIGN.md`, an ADR or the ExecPlan. A prototype is never the only copy of a decision.
