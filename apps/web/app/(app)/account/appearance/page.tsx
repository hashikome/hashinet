"use client";

import { type Me, THEME_PREFERENCES, type ThemePreference } from "@hashinet/types";
import { Panel, SettingRow, useToast } from "@/components/hearth/ui";
import { api, messageOf } from "@/lib/api";
import { useSession } from "@/lib/session";
import { applyTheme } from "@/lib/theme";

const LABEL: Record<ThemePreference, string> = { light: "Light", dark: "Dark", system: "System" };

/** Appearance: the theme, kept with the person so it follows them to every device. */
export default function AppearancePage() {
  const { me, replace } = useSession();
  const toast = useToast();
  const choose = async (theme: ThemePreference) => {
    const was = me.theme;
    applyTheme(theme);
    try {
      replace(await api.put<Me>("/api/me", { theme }));
    } catch (e) {
      applyTheme(was);
      toast(messageOf(e));
    }
  };
  return (
    <Panel title="Appearance">
      <ul className="rows">
        <SettingRow
          title="Theme"
          sub="System follows your device."
          action={
            <div className="segs">
              {THEME_PREFERENCES.map((t) => (
                <button
                  key={t}
                  className={`seg${t === me.theme ? " on" : ""}`}
                  type="button"
                  aria-pressed={t === me.theme}
                  onClick={() => void choose(t)}
                >
                  {LABEL[t]}
                </button>
              ))}
            </div>
          }
        />
      </ul>
    </Panel>
  );
}
