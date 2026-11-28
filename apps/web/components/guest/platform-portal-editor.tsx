"use client";

import type { GuestContext, PlatformPortal, PortalContent, PortalTheme } from "@hashinet/types";
import { useState } from "react";
import { api, messageOf } from "@/lib/api";
import { coloursTooClose } from "@/lib/portal-colours";
import { useSubmit } from "@/lib/submit";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Dialog } from "../ui/dialog";
import { Button, Field, Panel, Pill, Table, useToast } from "../ui/ui";
import { OPENS_HINT, PortalPreview, Segs, Wording } from "./portal-editor";

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
