/**
 * The guest portal's colours, from the venue's two (prototype portal.js `portalVars`): text is
 * midnight or off-white, whichever reads on the page (black or white where neither reaches
 * 4.5:1); the secondary grey is the softest that still reads; field edges reach 3:1.
 */
const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const mix = (a: string, b: string, t: number) =>
  `#${rgb(a)
    .map((x, i) =>
      Math.round(x + ((rgb(b)[i] ?? 0) - x) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
/** The first colour from `from` towards `to` that reaches `min` against every base. */
function reach(from: string, to: string, bases: string[], min: number): string {
  for (let t = 0; t <= 1.001; t += 0.02) {
    const c = mix(from, to, t);
    if (bases.every((b) => contrast(c, b) >= min)) return c;
  }
  return to;
}
function ink(bg: string): string {
  const on = (c: string) => Math.min(contrast(c, bg), contrast(c, mix(bg, "#ffffff", 0.05)));
  const best = (a: string, b: string) => (on(a) >= on(b) ? a : b);
  const chosen = best("#0d1b2a", "#eef1f4");
  return on(chosen) >= 4.6 ? chosen : best("#000000", "#ffffff");
}
const HEX = /^#[0-9a-fA-F]{6}$/;

/** CSS custom properties for a page and its button colour. */
export function portalVars(page: string, button: string): Record<string, string> {
  const bg = HEX.test(page) ? page : "#0d1b2a";
  const act = HEX.test(button) ? button : "#f59e2a";
  const text = ink(bg);
  const dark = contrast(text, "#000000") > contrast(text, "#ffffff");
  const card = dark ? mix(bg, "#ffffff", 0.05) : "#ffffff";
  return {
    "--g-bg": bg,
    "--g-act": act,
    "--g-on-act": contrast("#0d1b2a", act) >= contrast("#ffffff", act) ? "#0d1b2a" : "#ffffff",
    "--g-ink": text,
    "--g-card": card,
    "--g-muted": reach(mix(text, bg, 0.45), text, [bg, card], 4.6),
    "--g-input": reach(mix(bg, text, 0.2), text, [bg, card], 3.1),
    "--g-line": mix(bg, text, 0.14),
    "--g-field": dark ? mix(bg, "#ffffff", 0.05) : "#ffffff",
    "--g-sel": contrast(act, card) >= 3 ? act : text,
    "--g-bad": reach(dark ? "#ff8a8a" : "#c4242a", text, [bg, card], 4.6),
  };
}
