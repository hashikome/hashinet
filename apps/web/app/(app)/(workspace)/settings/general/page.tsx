"use client";

import { type BusinessProfile, REGIONS, type Region } from "@hashinet/types";
import { useRef, useState } from "react";
import { BusinessMark } from "@/components/hearth/icons";
import { Button, Field, Head, useToast } from "@/components/hearth/ui";
import { api, messageOf } from "@/lib/api";
import { LoadFailed, useLoad } from "@/lib/load";
import { useCan, useSession } from "@/lib/session";
import { useSubmit } from "@/lib/submit";

/**
 * Settings › General (prototype `settings`): the business profile. Its name and logo head HashiNet
 * for the team and its logo shows on the portal of any venue without its own; the address goes on
 * its invoices. The owner changes it; business managers read it.
 */
export default function GeneralSettingsPage() {
  const { me, refresh } = useSession();
  const can = useCan();
  const profile = useLoad("business-profile", () => api.get<BusinessProfile>("/api/business"), [
    me.active.id,
  ]);
  return (
    <>
      <Head title="General" sub={profile.data?.name ?? me.active.business?.name ?? ""} />
      {profile.error ? <LoadFailed error={profile.error} retry={profile.reload} /> : null}
      {profile.data ? (
        <Profile
          key={me.active.id}
          profile={profile.data}
          edit={can("business.profile.update")}
          onSaved={(next) => {
            profile.set(next);
            // The name and logo head the menu: it reads them again.
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}

function Profile({
  profile,
  edit,
  onSaved,
}: {
  profile: BusinessProfile;
  edit: boolean;
  onSaved: (next: BusinessProfile) => void;
}) {
  const toast = useToast();
  const { busy, errors, run } = useSubmit();
  const [name, setName] = useState(profile.name);
  const [region, setRegion] = useState<Region>(profile.region);
  const [area, setArea] = useState(profile.area);
  const [logoBusy, setLogoBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const logo = async (send: () => Promise<BusinessProfile>, done: string) => {
    setLogoBusy(true);
    try {
      onSaved(await send());
      toast(done);
    } catch (e) {
      toast(messageOf(e));
    } finally {
      setLogoBusy(false);
    }
  };
  return (
    <section className="panel split" style={{ maxWidth: 1040 }}>
      <div className="split-head">
        <h2>Business profile</h2>
        <p className="muted">
          Your name and logo show at the top of HashiNet for your team and on the portal of any
          venue without its own. The address goes on your invoices.
          {edit ? "" : " Only the owner changes them."}
        </p>
      </div>
      <form
        className="form"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          let next: BusinessProfile | null = null;
          const ok = await run(async () => {
            next = await api.put<BusinessProfile>("/api/business", { name, region, area });
          }, "Saved.");
          if (ok && next) onSaved(next);
        }}
      >
        <div className="field">
          <span className="lbl">Logo</span>
          <div className="actions" style={{ gap: 14 }}>
            <BusinessMark name={name || profile.name} logoUrl={profile.logoUrl} size={56} />
            {edit ? (
              <div>
                <div className="actions">
                  <input
                    ref={file}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    onChange={(e) => {
                      const chosen = e.target.files?.[0];
                      e.target.value = "";
                      if (chosen)
                        void logo(
                          () => api.upload<BusinessProfile>("/api/business/logo", chosen),
                          "Logo uploaded.",
                        );
                    }}
                  />
                  <Button icon="upload" busy={logoBusy} onClick={() => file.current?.click()}>
                    {profile.logoUrl ? "Replace logo" : "Upload a logo"}
                  </Button>
                  {profile.logoUrl ? (
                    <Button
                      kind="danger"
                      disabled={logoBusy}
                      onClick={() =>
                        void logo(
                          () => api.delete<BusinessProfile>("/api/business/logo"),
                          "Logo removed.",
                        )
                      }
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
                <div className="hint">A square JPEG, PNG or WebP, up to 8 MB</div>
              </div>
            ) : null}
          </div>
        </div>
        {edit ? (
          <fieldset className="plain form">
            <Field
              label="Business name"
              id="gb-n"
              error={errors.name ? `The name ${errors.name}.` : undefined}
            >
              <input
                id="gb-n"
                className="input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <div className="pair">
              <Field label="Region" id="gb-r" error={errors.region}>
                <select
                  id="gb-r"
                  className="input"
                  value={region}
                  onChange={(e) => setRegion(e.target.value as Region)}
                >
                  {REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Area or street"
                id="gb-a"
                hint="A street, or a landmark and area"
                error={errors.area ? `The area ${errors.area}.` : undefined}
              >
                <input
                  id="gb-a"
                  className="input"
                  type="text"
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                />
              </Field>
            </div>
          </fieldset>
        ) : (
          <dl className="profile-list">
            <div>
              <dt>Business name</dt>
              <dd>{profile.name}</dd>
            </div>
            <div>
              <dt>Where it is</dt>
              <dd>
                {profile.area}, {profile.region}
              </dd>
            </div>
          </dl>
        )}
        {edit ? (
          <div className="form-save actions">
            <Button
              kind="primary"
              type="submit"
              busy={busy}
              disabled={!name.trim() || !area.trim()}
            >
              Save
            </Button>
          </div>
        ) : null}
      </form>
    </section>
  );
}
