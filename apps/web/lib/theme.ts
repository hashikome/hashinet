import type { ThemePreference } from "@hashinet/types";

/**
 * The theme is the person's (`/api/me`), copied here so the first paint already has it. Signed out
 * there is no choice yet: sign-in and invitation pages are always dark (DESIGN.md).
 */
const KEY = "hashinet-theme";

/** The pages someone sees before signing in. */
export const SIGNED_OUT = /^\/(sign-in|invite)(\/|$)/;

/** Runs before the first paint, in <head>: no flash of the wrong theme. */
export const THEME_SCRIPT = `(function(){var d=document.documentElement;if(/${SIGNED_OUT.source}/.test(location.pathname)){d.dataset.theme="dark";return}try{var t=localStorage.getItem("${KEY}")||"system";d.dataset.theme=t==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t}catch(e){}})()`;

export function applyTheme(theme: ThemePreference): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Private windows may refuse storage; the theme still applies to this page.
  }
  const dark =
    theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
