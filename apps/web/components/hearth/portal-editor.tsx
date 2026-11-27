"use client";

import type {
  GuestContext,
  PlatformPortal,
  PortalContent,
  PortalEditor,
  PortalLook,
  PortalTheme,
} from "@hashinet/types";
import { type ReactNode, useState } from "react";
import { GuestPortal, type PreviewPage } from "@/app/join/portal";
import { api, messageOf } from "@/lib/api";
import { coloursTooClose } from "@/lib/portal-colours";
import { useSubmit } from "@/lib/submit";
import { ConfirmDialog } from "./confirm-dialog";
import { Dialog } from "./dialog";
import { Icon } from "./icons";
import { LogoPicker } from "./logo-picker";
import { Button, Field, Panel, Pill, Table, useToast } from "./ui";

/** The guest pages the preview steps through, grouped by path (prototype `portalTabs`). */
const PAGES: [group: string, pages: [PreviewPage | "counter", string][]][] = [
  [
    "Voucher",
    [
      ["voucher", "Voucher page"],
      ["wrong-code", "Wrong code"],
      ["run-out", "Run out"],
    ],
  ],
  [
    "Buying",
    [
      ["buy", "Buy page"],
      ["counter", "Buy page, at the counter"],
      ["approve", "Approve"],
      ["pay-failed", "Payment failed"],
      ["paid", "Paid"],
    ],
  ],
  [
    "Signing in and after",
    [
      ["signing", "Signing in"],
      ["sign-failed", "Sign-in failed"],
      ["online", "Online"],
      ["terms", "Terms"],
    ],
  ],
];
const ALL = PAGES.flatMap(([, pages]) => pages);

/**
 * The phone beside the form (prototype `portalPreview`): the portal a guest gets, on the page
 * picked, with the form's colours and words as they are typed.
 */
function PortalPreview({ context }: { context: GuestContext }) {
  const [id, setId] = useState<PreviewPage | "counter">("voucher");
  const at = ALL.findIndex(([p]) => p === id);
  const step = (by: number) => setId(ALL[(at + by + ALL.length) % ALL.length]?.[0] ?? "voucher");
  // Both buy pages a guest can meet: by mobile money, or at the counter (where to buy, who to call).
  const shown = { ...context, sellsOnline: id !== "counter" };
  return (
    <div className="gp-col">
      <div className="gp-pick">
        <button
          className="btn secondary icon-btn"
          type="button"
          aria-label="Previous page"
          onClick={() => step(-1)}
        >
          <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}>
            <Icon name="chevron" size={16} />
          </span>
        </button>
        <select
          className="input"
          aria-label="Guest page"
          value={id}
          onChange={(e) => setId(e.target.value as PreviewPage | "counter")}
        >
          {PAGES.map(([group, pages]) => (
            <optgroup key={group} label={group}>
              {pages.map(([p, label]) => (
                <option key={p} value={p}>
                  {label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          className="btn secondary icon-btn"
          type="button"
          aria-label="Next page"
          onClick={() => step(1)}
        >
          <Icon name="chevron" size={16} />
        </button>
        <span className="gp-count">
          {at + 1} of {ALL.length}
        </span>
      </div>
      <div className="phone">
        <GuestPortal key={id} preview={{ context: shown, page: id === "counter" ? "buy" : id }} />
      </div>
    </div>
  );
}

/** Two choices side by side (prototype `segPick`). */
function Segs<T extends string | boolean>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
  hint?: ReactNode;
}) {
  return (
    <div className="field">
      <span className="lbl">{label}</span>
      <fieldset className="segs" aria-label={label}>
        {options.map(([v, text]) => (
          <button
            key={String(v)}
            className={`seg${v === value ? " on" : ""}`}
            type="button"
            aria-pressed={v === value}
            onClick={() => onChange(v)}
          >
            {text}
          </button>
        ))}
      </fieldset>
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

const OPENS_HINT = {
  voucher: "For a venue that sells at the counter. Guests can still buy from it.",
  buy: "For a venue where guests buy on the portal. Guests with a voucher can still use it.",
};

/** The wording a portal shows, and its terms (prototype `portalWording`, `portalTerms`). */
function Wording({
  content,
  set,
  errors,
}: {
  content: PortalContent;
  set: (change: Partial<PortalContent>) => void;
  errors: Record<string, string>;
}) {
  const line = (
    key: "welcome" | "voucherText" | "buyText" | "whereToBuy",
    label: string,
    id: string,
    hint?: string,
  ) => (
    <Field
      label={label}
      id={id}
      hint={hint}
      error={errors[key] ? `${label} ${errors[key]}.` : undefined}
    >
      <input
        id={id}
        className="input"
        type="text"
        value={content[key]}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <>
      {line("welcome", "Welcome", "pw")}
      {line("voucherText", "Voucher page", "pv")}
      {line("buyText", "Buy page", "pb")}
      {line(
        "whereToBuy",
        "Where to buy",
        "pwb",
        "Where a guest with no voucher buys one, in person.",
      )}
      <Field
        label="Contact number (optional)"
        id="pcn"
        hint="A number guests can call to find the seller. Shown on the portal to anyone on the WiFi."
        error={errors.contactPhone ? `The number ${errors.contactPhone}.` : undefined}
      >
        <input
          id="pcn"
          className="input"
          type="tel"
          inputMode="tel"
          value={content.contactPhone ?? ""}
          onChange={(e) => set({ contactPhone: e.target.value })}
        />
      </Field>
      <label className="check">
        <input
          type="checkbox"
          checked={content.requireTerms}
          onChange={(e) => set({ requireTerms: e.target.checked })}
        />{" "}
        <span>Guests accept terms when they join</span>
      </label>
      {content.requireTerms ? (
        <Field
          label="Terms"
          id="pterms"
          hint={'Shown on the portal behind "the venue\'s terms", under Connect and Pay.'}
          error={errors.terms ? `The terms ${errors.terms}.` : undefined}
        >
          <textarea
            id="pterms"
            className="input"
            rows={5}
            value={content.terms}
            onChange={(e) => set({ terms: e.target.value })}
          />
        </Field>
      ) : null}
    </>
  );
}

/**
 * A business's or venue's portal (prototype `portalEditor`): its look, its wording, and the phone
 * showing it. `path` is where it is kept: the business's template, or a venue's own.
 */
export function LookEditor({
  path,
  editor,
  venue,
  onSaved,
}: {
  path: string;
  editor: PortalEditor;
  /** A venue's own: it can have its own logo. Null for what new venues start with. */
  venue: { name: string } | null;
  onSaved: (next: PortalEditor) => void;
}) {
  const _toast = useToast();
  const { busy, errors, run } = useSubmit();
  const [look, setLook] = useState<PortalLook>(editor.look);
  const theme = editor.themes.find(
    (t) => t.pageColor === look.pageColor && t.buttonColor === look.buttonColor,
  );
  const [custom, setCustom] = useState(!theme);
  // "Your colours" keeps its own pair, so it never looks like a theme: wine and gold to start.
  const [own, setOwn] = useState(
    theme
      ? { pageColor: "#7A1F2B", buttonColor: "#F2C14E" }
      : { pageColor: editor.look.pageColor, buttonColor: editor.look.buttonColor },
  );
  const colour = (change: Partial<typeof own>) => {
    setOwn((o) => ({ ...o, ...change }));
    set(change);
  };
  const [restoring, setRestoring] = useState(false);
  const set = (change: Partial<PortalLook>) => setLook((l) => ({ ...l, ...change }));
  const context: GuestContext = {
    ...editor.preview,
    settings: { ...look, logoUrl: look.showLogo ? editor.logo.url : null },
  };
  const logoHint = venue
    ? editor.logo.own
      ? "This venue's own logo"
      : editor.logo.url
        ? "Using the business logo"
        : "No logo yet"
    : editor.logo.url
      ? "The business logo"
      : "No logo yet";

  return (
    <div className="guest-layout">
      <div className="stack-panels">
        <Panel title="Look">
          <div className="form">
            <Segs
              label="Opens on"
              value={look.opensOn}
              options={[
                ["voucher", "Voucher page"],
                ["buy", "Buy page"],
              ]}
              onChange={(opensOn) => set({ opensOn })}
              hint={OPENS_HINT[look.opensOn]}
            />
            <div className="field">
              <span className="lbl">Theme</span>
              <fieldset className="swatches plain" aria-label="Theme">
                {editor.themes.map((t) => (
                  <ThemeSwatch
                    key={t.id}
                    theme={t}
                    on={!custom && theme?.id === t.id}
                    pick={() => {
                      setCustom(false);
                      set({ pageColor: t.pageColor, buttonColor: t.buttonColor });
                    }}
                  />
                ))}
                <ThemeSwatch
                  theme={{ name: "Your colours", ...own }}
                  on={custom}
                  pick={() => {
                    setCustom(true);
                    set(own);
                  }}
                />
              </fieldset>
              <span className="hint">{custom ? "Your colours" : theme?.name}</span>
            </div>
            {custom ? (
              <>
                <div className="colours">
                  <Field label="Page colour" id="pc1">
                    <input
                      id="pc1"
                      className="input"
                      type="color"
                      value={look.pageColor.toLowerCase()}
                      onChange={(e) => colour({ pageColor: e.target.value.toUpperCase() })}
                    />
                  </Field>
                  <Field label="Button colour" id="pc2">
                    <input
                      id="pc2"
                      className="input"
                      type="color"
                      value={look.buttonColor.toLowerCase()}
                      onChange={(e) => colour({ buttonColor: e.target.value.toUpperCase() })}
                    />
                  </Field>
                </div>
                <span className="hint">
                  {coloursTooClose(look.pageColor, look.buttonColor)
                    ? "These two are close, so guests may not see the button. Choose a button colour further from the page."
                    : "Text, lines and field edges are worked out from these two, so the portal stays readable."}
                </span>
              </>
            ) : null}
            <Segs
              label="Logo"
              value={look.showLogo}
              options={[
                [false, "No logo"],
                [true, "Show the logo"],
              ]}
              onChange={(showLogo) => set({ showLogo })}
            />
            {look.showLogo && venue ? (
              <div className="field">
                <LogoPicker
                  has={editor.logo.own}
                  upload={(f) => api.upload<PortalEditor>(`${path}/logo`, f)}
                  remove={() => api.delete<PortalEditor>(`${path}/logo`)}
                  onSaved={onSaved}
                  note={logoHint}
                />
              </div>
            ) : look.showLogo ? (
              <span className="hint">{logoHint}</span>
            ) : null}
          </div>
        </Panel>
        <Panel title="Wording">
          <form
            className="form"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              let next: PortalEditor | null = null;
              const ok = await run(async () => {
                next = await api.put<PortalEditor>(path, look);
              }, "Saved.");
              if (ok && next) onSaved(next);
            }}
          >
            <Wording content={look} set={set} errors={errors} />
            <div className="form-save actions">
              <Button kind="primary" type="submit" busy={busy}>
                Save
              </Button>
              <Button onClick={() => setRestoring(true)}>Restore defaults</Button>
            </div>
          </form>
        </Panel>
      </div>
      <PortalPreview context={context} />
      {restoring ? (
        <ConfirmDialog
          what={
            venue
              ? `${venue.name}'s colours and wording go back to what new venues start with. Its logo stays.`
              : "What new venues start with goes back to HashiNet's defaults. Venues already added keep theirs."
          }
          onClose={() => setRestoring(false)}
          send={() => api.delete<PortalEditor>(path)}
          onDone={(next) => {
            setRestoring(false);
            setLook(next.look);
            setCustom(
              !next.themes.some(
                (t) =>
                  t.pageColor === next.look.pageColor && t.buttonColor === next.look.buttonColor,
              ),
            );
            onSaved(next);
          }}
        />
      ) : null}
    </div>
  );
}

function ThemeSwatch({
  theme,
  on,
  pick,
}: {
  theme: Pick<PortalTheme, "name" | "pageColor" | "buttonColor">;
  on: boolean;
  pick: () => void;
}) {
  return (
    <label className={`sw${on ? " on" : ""}`} title={theme.name}>
      <input className="sr" type="radio" name="theme" checked={on} onChange={pick} />
      <span className="sr">{theme.name}</span>
      <i style={{ background: theme.pageColor }} />
      <i style={{ background: theme.buttonColor }} />
    </label>
  );
}

/** A sample venue for the platform's preview: what a new business's first venue shows. */
const SAMPLE: GuestContext = {
  venueName: "Your venue",
  internet: true,
  sellsOnline: true,
  selling: true,
  settings: {
    opensOn: "voucher",
    showLogo: false,
    welcome: "",
    voucherText: "",
    buyText: "",
    whereToBuy: "",
    contactPhone: null,
    requireTerms: true,
    terms: "",
    pageColor: "#0D1B2A",
    buttonColor: "#F59E2A",
    logoUrl: null,
  },
  packages: [
    {
      id: "h",
      name: "1 hour",
      durationMinutes: 60,
      priceTsh: "500.00",
      downloadSpeedMbps: 10,
      dataLimitGb: null,
      payable: true,
    },
    {
      id: "d",
      name: "1 day",
      durationMinutes: 1440,
      priceTsh: "1500.00",
      downloadSpeedMbps: 10,
      dataLimitGb: null,
      payable: true,
    },
    {
      id: "w",
      name: "1 week",
      durationMinutes: 10080,
      priceTsh: "7000.00",
      downloadSpeedMbps: 10,
      dataLimitGb: null,
      payable: true,
    },
  ],
};

/**
 * The platform's Captive portal (prototype `platformPortal`): the themes every business picks
 * from, one the default, and what a new business's portal starts with. Its admin and managers
 * change them; its operators look.
 */
export function PlatformPortalEditor({
  portal,
  manage,
  onSaved,
}: {
  portal: PlatformPortal;
  manage: boolean;
  onSaved: (next: PlatformPortal) => void;
}) {
  const toast = useToast();
  const { busy, errors, run } = useSubmit();
  const [content, setContent] = useState<PortalContent>(portal.content);
  const fallback = portal.themes.find((t) => t.isDefault) ?? portal.themes[0];
  const [shownTheme, setShownTheme] = useState(fallback?.id ?? null);
  const [adding, setAdding] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [removing, setRemoving] = useState<PortalTheme | null>(null);
  const seen = portal.themes.find((t) => t.id === shownTheme) ?? fallback;
  const set = (change: Partial<PortalContent>) => setContent((c) => ({ ...c, ...change }));
  const context: GuestContext = {
    ...SAMPLE,
    settings: {
      ...content,
      pageColor: seen?.pageColor ?? SAMPLE.settings.pageColor,
      buttonColor: seen?.buttonColor ?? SAMPLE.settings.buttonColor,
      logoUrl: null,
    },
  };
  const act = async (send: () => Promise<PlatformPortal>, done: string) => {
    try {
      onSaved(await send());
      toast(done);
    } catch (e) {
      toast(messageOf(e));
    }
  };
  return (
    <div className="guest-layout">
      <div className="stack-panels">
        <Panel
          title="Themes"
          right={
            manage ? (
              <Button icon="plus" onClick={() => setAdding(true)}>
                Add a theme
              </Button>
            ) : null
          }
        >
          <p className="hint">Pick one to see it on the phone.</p>
          <Table
            narrow
            cols={[["Theme"], [""], [""]]}
            rows={portal.themes.map((t) => ({
              key: t.id,
              cells: [
                <label className="sw-row theme-pick" key="t">
                  <input
                    type="radio"
                    name="ptheme"
                    checked={seen?.id === t.id}
                    onChange={() => setShownTheme(t.id)}
                  />
                  <span className="sw on-card">
                    <i style={{ background: t.pageColor }} />
                    <i style={{ background: t.buttonColor }} />
                  </span>
                  <span className="name">{t.name}</span>
                </label>,
                t.isDefault ? (
                  <Pill key="d" kind="neutral">
                    Default
                  </Pill>
                ) : (
                  ""
                ),
                manage && !t.isDefault ? (
                  <div className="actions row-actions" key="a">
                    <Button
                      onClick={() =>
                        void act(
                          () => api.put<PlatformPortal>(`/api/portal/themes/${t.id}/default`),
                          `${t.name} is the default.`,
                        )
                      }
                    >
                      Make default
                    </Button>
                    <Button kind="danger" onClick={() => setRemoving(t)}>
                      Remove
                    </Button>
                  </div>
                ) : (
                  ""
                ),
              ],
            }))}
          />
        </Panel>
        <Panel title="Starts with">
          <fieldset className="plain form" disabled={!manage}>
            <Segs
              label="Opens on"
              value={content.opensOn}
              options={[
                ["voucher", "Voucher page"],
                ["buy", "Buy page"],
              ]}
              onChange={(opensOn) => set({ opensOn })}
              hint={OPENS_HINT[content.opensOn]}
            />
            <Segs
              label="Logo"
              value={content.showLogo}
              options={[
                [false, "No logo"],
                [true, "Show the logo"],
              ]}
              onChange={(showLogo) => set({ showLogo })}
            />
          </fieldset>
        </Panel>
        <Panel title="Wording">
          <form
            className="form"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              let next: PlatformPortal | null = null;
              const ok = await run(async () => {
                next = await api.put<PlatformPortal>("/api/portal", content);
              }, "Saved. New businesses start with it.");
              if (ok && next) onSaved(next);
            }}
          >
            <fieldset className="plain form" disabled={!manage}>
              <Wording content={content} set={set} errors={errors} />
            </fieldset>
            {manage ? (
              <div className="form-save actions">
                <Button kind="primary" type="submit" busy={busy}>
                  Save
                </Button>
                <Button onClick={() => setRestoring(true)}>Restore defaults</Button>
              </div>
            ) : null}
          </form>
        </Panel>
      </div>
      <PortalPreview context={context} />
      {adding ? (
        <AddTheme
          onClose={() => setAdding(false)}
          onSaved={(next) => {
            setAdding(false);
            onSaved(next);
          }}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          confirm="Remove theme"
          done={`${removing.name} removed.`}
          what={`${removing.name} is no longer offered. Portals already using its colours keep them.`}
          send={() => api.delete<PlatformPortal>(`/api/portal/themes/${removing.id}`)}
          onClose={() => setRemoving(null)}
          onDone={(next) => {
            setRemoving(null);
            onSaved(next);
          }}
        />
      ) : null}
      {restoring ? (
        <ConfirmDialog
          what="What new businesses start with goes back to HashiNet's own wording. The themes stay."
          send={() => api.delete<PlatformPortal>("/api/portal")}
          onClose={() => setRestoring(false)}
          onDone={(next) => {
            setRestoring(false);
            setContent(next.content);
            onSaved(next);
          }}
        />
      ) : null}
    </div>
  );
}

/** A new theme joins the choices every business has (prototype `themeDialog`). */
function AddTheme({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (next: PlatformPortal) => void;
}) {
  const { busy, errors, run } = useSubmit();
  const [name, setName] = useState("");
  const [pageColor, setPage] = useState("#2A1B3D");
  const [buttonColor, setButton] = useState("#F59E2A");
  return (
    <Dialog label="Add a theme" onClose={onClose}>
      <form
        className="form"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          let next: PlatformPortal | null = null;
          const ok = await run(async () => {
            next = await api.post<PlatformPortal>("/api/portal/themes", {
              name,
              pageColor,
              buttonColor,
            });
          }, `${name.trim()} added.`);
          if (ok && next) onSaved(next);
        }}
      >
        <h2>Add a theme</h2>
        <p className="muted">It joins the choices every business has.</p>
        <Field label="Name" id="tn" error={errors.name ? `The name ${errors.name}.` : undefined}>
          <input
            id="tn"
            className="input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="even">
          <Field label="Page colour" id="tb">
            <input
              id="tb"
              className="input"
              type="color"
              value={pageColor.toLowerCase()}
              onChange={(e) => setPage(e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Button colour" id="ta">
            <input
              id="ta"
              className="input"
              type="color"
              value={buttonColor.toLowerCase()}
              onChange={(e) => setButton(e.target.value.toUpperCase())}
            />
          </Field>
        </div>
        {coloursTooClose(pageColor, buttonColor) ? (
          <p className="hint">
            These two are close, so guests may not see the button. Choose a button colour further
            from the page.
          </p>
        ) : null}
        <div className="dialog-actions">
          <Button kind="primary" type="submit" busy={busy} disabled={!name.trim()}>
            Add theme
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
