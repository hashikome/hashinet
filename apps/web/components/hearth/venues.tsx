"use client";

import {
  REGIONS,
  type Region,
  type VenueRecord,
  type VenueResponse,
  type VenueStatus,
} from "@hashinet/types";
import { useState } from "react";
import { api } from "@/lib/api";
import { useSubmit } from "@/lib/submit";
import { Dialog } from "./dialog";
import { Button, CONDITION, Field, type PillKind } from "./ui";

/** A venue's own status, as its owner sets it. */
export const STATUS: Record<VenueStatus, [string, PillKind]> = {
  active: ["Open", "ok"],
  maintenance: ["Under maintenance", "wait"],
  inactive: ["Closed", "neutral"],
};

/** How a venue's routers are doing, as the API says whether it sells. */
export function sellingPill(v: VenueRecord): [string, PillKind] {
  const s = v.selling;
  if (s.state === "selling") return CONDITION.serving;
  if (s.state === "not-set-up") return CONDITION["setting-up"];
  if (s.state === "paused") return ["Selling paused", "bad"];
  return CONDITION[s.state];
}

/**
 * Add a venue, or change one (prototype `venueNewDialog`, `venueEditDialog`): its name, where it
 * is, and once it exists its status. Adding starts its onboarding; how its router comes is chosen on
 * its page next.
 */
export function VenueDialog({
  venue,
  onClose,
  onSaved,
}: {
  venue: VenueRecord | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { busy, errors, run } = useSubmit();
  const [name, setName] = useState(venue?.name ?? "");
  const [region, setRegion] = useState<Region | "">(venue?.region ?? "");
  const [area, setArea] = useState(venue?.area ?? "");
  const [status, setStatus] = useState<VenueStatus>(venue?.status ?? "active");
  const title = venue ? "Edit venue" : "Add a venue";
  return (
    <Dialog label={title} onClose={onClose}>
      <form
        className="form"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          let saved: VenueRecord | null = null;
          const body = {
            name,
            region,
            area,
            status,
          };
          const ok = await run(
            async () => {
              saved = (
                venue
                  ? await api.put<VenueResponse>(`/api/venues/${venue.id}`, body)
                  : await api.post<VenueResponse>("/api/venues", body)
              ).venue;
            },
            venue ? "Saved." : "Venue added. Next, choose how its router comes.",
          );
          if (ok && saved) onSaved((saved as VenueRecord).id);
        }}
      >
        <h2>{title}</h2>
        <p className="muted">
          {venue
            ? "Its name shows on the portal and on vouchers."
            : "A new place to sell WiFi. Getting it online comes next."}
        </p>
        <Field
          label="Venue name"
          id="vn"
          hint="What guests see on the portal and on vouchers"
          error={errors.name ? `The name ${errors.name}.` : undefined}
        >
          <input
            id="vn"
            className="input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field
          label="Region"
          id="vr"
          error={errors.region ? `The region ${errors.region}.` : undefined}
        >
          <select
            id="vr"
            className="input"
            value={region}
            onChange={(e) => setRegion(e.target.value as Region)}
          >
            <option value="" disabled>
              Choose a region
            </option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Area"
          id="va"
          hint="The area or street, such as Mjimwema, Kigamboni"
          error={errors.area ? `The area ${errors.area}.` : undefined}
        >
          <input
            id="va"
            className="input"
            type="text"
            value={area}
            onChange={(e) => setArea(e.target.value)}
          />
        </Field>
        {venue ? (
          <Field label="Status" id="vs">
            <select
              id="vs"
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value as VenueStatus)}
            >
              {(Object.keys(STATUS) as VenueStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS[s][0]}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <div className="dialog-actions">
          <Button
            kind="primary"
            type="submit"
            busy={busy}
            disabled={!name.trim() || !region || !area.trim()}
          >
            {venue ? "Save" : "Add venue"}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
