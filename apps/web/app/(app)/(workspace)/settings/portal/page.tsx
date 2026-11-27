"use client";

import type { PlatformPortal, PortalEditor } from "@hashinet/types";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { LookEditor, PlatformPortalEditor } from "@/components/hearth/portal-editor";
import { Field, Head } from "@/components/hearth/ui";
import { api } from "@/lib/api";
import { LoadFailed, useLoad } from "@/lib/load";
import { useCan, useSession } from "@/lib/session";
import { useVenues } from "@/lib/venues";

/** Settings › Captive portal keeps the venue it shows in the address. */
export default function CaptivePortalPage() {
  return (
    <Suspense>
      <CaptivePortal />
    </Suspense>
  );
}

/**
 * Settings › Captive portal (prototype `portalEditor`, `platformPortal`). HashiNet's team keeps what
 * a new business starts with and the themes. In a business, whoever reaches the whole business with
 * more than one venue starts on what new venues start with; a venue's portal is its own.
 */
function CaptivePortal() {
  const { me } = useSession();
  if (me.active.scope === "platform") return <Platform />;
  return <Business />;
}

function Platform() {
  const can = useCan();
  const portal = useLoad("portal", () => api.get<PlatformPortal>("/api/portal"), []);
  return (
    <>
      <Head
        title="Captive portal"
        sub={`What every new business's portal starts with. Businesses already added keep theirs.${can("portal.defaults.update") ? "" : " Only the platform admin and managers change them."}`}
      />
      {portal.error ? <LoadFailed error={portal.error} retry={portal.reload} /> : null}
      {portal.data ? (
        <PlatformPortalEditor
          portal={portal.data}
          manage={can("portal.defaults.update")}
          onSaved={portal.set}
        />
      ) : null}
    </>
  );
}

function Business() {
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const { all: venues } = useVenues();
  const many = can("portal.business.update") && venues.length > 1;
  const asked = venues.find((v) => v.id === params.get("venue")) ?? null;
  const venue = asked ?? (many ? null : (venues[0] ?? null));
  const path = venue ? `/api/venues/${venue.id}/portal` : "/api/portal/business";
  const editor = useLoad("portal-editor", () => api.get<PortalEditor>(path), [path]);
  const picker =
    venues.length > 1 ? (
      <Field label="Venue" id="pv">
        <select
          id="pv"
          className="input picker"
          value={venue?.id ?? "new"}
          onChange={(e) =>
            router.replace(
              e.target.value === "new"
                ? "/settings/portal"
                : `/settings/portal?venue=${e.target.value}`,
            )
          }
        >
          {many ? <option value="new">New venues</option> : null}
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </Field>
    ) : null;
  return (
    <>
      <Head
        title="Captive portal"
        sub={
          venue
            ? `What guests see at ${venue.name}`
            : "What every new venue starts with. Changes apply to venues added after them."
        }
      />
      {picker}
      {editor.error ? <LoadFailed error={editor.error} retry={editor.reload} /> : null}
      {editor.data ? (
        <LookEditor
          key={path}
          path={path}
          editor={editor.data}
          venue={venue}
          onSaved={editor.set}
        />
      ) : null}
    </>
  );
}
