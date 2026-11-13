"use client";

import type {
  BootstrapScriptResponse,
  RouterChecks,
  RouterJourney,
  RouterList,
  RouterRecord,
  RouterResponse,
  RouterSetupPhaseStatus,
  VenueResponse,
} from "@hashinet/types";
import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/hearth/dialog";
import {
  Button,
  CONDITION,
  CopyText,
  Field,
  Head,
  Panel,
  Pill,
  type PillKind,
  SettingRow,
  useToast,
} from "@/components/hearth/ui";
import { ApiRequestError, api, messageOf } from "@/lib/api";
import { longDate, when } from "@/lib/dates";
import { LoadFailed, useLoad } from "@/lib/load";
import { useCan } from "@/lib/session";
import { useSubmit } from "@/lib/submit";

const PHASE: Record<RouterSetupPhaseStatus, [string, PillKind]> = {
  pending: ["Waiting", "neutral"],
  running: ["Running", "wait"],
  pass: ["Done", "ok"],
  warn: ["Warning", "wait"],
  fail: ["Failed", "bad"],
  skipped: ["Skipped", "neutral"],
};
const CHECK: Record<RouterChecks["checks"][number]["status"], [string, PillKind]> = {
  pass: ["Passed", "ok"],
  warn: ["Warning", "wait"],
  fail: ["Failed", "bad"],
  skipped: ["Not checked", "neutral"],
};

/**
 * A venue's router (prototype `router` and `newRouter`). HashiNet's team adds it, gives it its
 * setup script and sets it up; its operators run the checks; the business reads it. Setup stays
 * the first build's (bootstrap script, background setup, readiness), now under the access policy.
 */
export default function RouterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: venueId } = use(params);
  const can = useCan();
  const data = useLoad(async () => {
    const [{ venue }, { routers }] = await Promise.all([
      api.get<VenueResponse>(`/api/venues/${venueId}`),
      api.get<RouterList>(`/api/routers?venueId=${venueId}`),
    ]);
    return { venue, router: routers[0] ?? null };
  }, [venueId]);
  const crumb = can("business.read") ? (
    <>
      <Link href="/businesses">Businesses</Link> /
    </>
  ) : undefined;

  if (data.error) {
    return (
      <>
        <Head title="Router" sub="" crumb={crumb} />
        <LoadFailed error={data.error} retry={data.reload} />
      </>
    );
  }
  if (!data.data) return <Head title="Router" sub="" crumb={crumb} />;
  const { venue, router } = data.data;

  if (!router) {
    return (
      <>
        <Head
          title={`${venue.name} has no router yet`}
          sub={`${venue.area}, ${venue.region}`}
          crumb={crumb}
        />
        {can("router.install") ? (
          <AddRouter venueId={venue.id} venueName={venue.name} onAdded={data.reload} />
        ) : (
          <Panel title="What happens next">
            <p className="muted">
              HashiNet&apos;s team adds it once its setup is scheduled, then sets it up from here.
              This page then shows whether it is serving.
            </p>
          </Panel>
        )}
      </>
    );
  }
  return <RouterView router={router} venueName={venue.name} crumb={crumb} reload={data.reload} />;
}

function AddRouter({
  venueId,
  venueName,
  onAdded,
}: {
  venueId: string;
  venueName: string;
  onAdded: () => Promise<void>;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: venueName,
    model: "hAP ax²",
    ipAddress: "",
    networkRange: "10.5.50.0/24",
    hotspotInterface: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Panel title="Add a router">
      <p className="muted" style={{ marginBottom: 12 }}>
        A few details, then a setup script for the MikroTik router.
      </p>
      <form
        className="form"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErrors({});
          try {
            await api.post<RouterResponse>("/api/routers", {
              venueId,
              name: form.name,
              model: form.model,
              ipAddress: form.ipAddress,
              apiUsername: "hashinet",
              ssid: form.name,
              networkRange: form.networkRange,
              hotspotInterface: form.hotspotInterface.trim(),
            });
            await onAdded();
            toast("Router added. Get its setup script next.");
          } catch (err) {
            if (err instanceof ApiRequestError && err.details) setErrors(err.details);
            else toast(messageOf(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field
          label="Router name"
          id="rn"
          error={errors.name ? `The name ${errors.name}.` : undefined}
          hint="The WiFi name guests see"
        >
          <input id="rn" className="input" value={form.name} onChange={set("name")} />
        </Field>
        <Field
          label="Which model?"
          id="rm"
          hint="HashiNet checks it against the router itself when it connects"
        >
          <select id="rm" className="input" value={form.model} onChange={set("model")}>
            {[
              "hAP ax²",
              "hAP ax³",
              "hAP ac²",
              "hAP lite",
              "Another MikroTik router on RouterOS 7",
            ].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field
          label="Its address on the venue's network"
          id="ri"
          error={errors.ipAddress ? `The address ${errors.ipAddress}.` : undefined}
          hint="A free address on the ISP router's network, such as 192.168.1.2"
        >
          <input
            id="ri"
            className="input"
            inputMode="decimal"
            value={form.ipAddress}
            onChange={set("ipAddress")}
          />
        </Field>
        <details>
          <summary className="small muted" style={{ cursor: "pointer" }}>
            Hotspot network
          </summary>
          <div className="form" style={{ marginTop: 10 }}>
            <Field
              label="Network"
              id="rh"
              error={errors.networkRange ? `The network ${errors.networkRange}.` : undefined}
              hint="Change it only if it clashes with the venue's own network"
            >
              <input
                id="rh"
                className="input"
                value={form.networkRange}
                onChange={set("networkRange")}
              />
            </Field>
            <Field
              label="Hotspot port"
              id="rp"
              error={errors.hotspotInterface ? `The port ${errors.hotspotInterface}.` : undefined}
              hint="Leave empty to use the router's WiFi. A board without WiFi names its port, such as ether2"
            >
              <input
                id="rp"
                className="input"
                value={form.hotspotInterface}
                onChange={set("hotspotInterface")}
              />
            </Field>
          </div>
        </details>
        <div className="form-save">
          <Button kind="primary" type="submit" busy={busy}>
            Add router
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function RouterView({
  router,
  venueName,
  crumb,
  reload,
}: {
  router: RouterRecord;
  venueName: string;
  crumb: React.ReactNode;
  reload: () => Promise<void>;
}) {
  const can = useCan();
  const toast = useToast();
  // Installing is the admin's, a manager's, and an operator's at a venue handed to them; the API
  // decides which venue.
  const install = can("router.install");
  const check = can("router.check");
  const journey = useLoad(
    () => api.get<RouterJourney>(`/api/routers/${router.id}/journey`),
    [router.id],
  );
  const [script, setScript] = useState<BootstrapScriptResponse | null>(null);
  const [checks, setChecks] = useState<RouterChecks | null>(null);
  const [busy, setBusy] = useState("");
  const [porting, setPorting] = useState(false);
  // The script's default route: the ISP router, most often the first address on its network.
  const [gateway, setGateway] = useState(router.ipAddress.replace(/\.\d+$/, ".1"));
  const j = journey.data;
  const running = j?.running ?? false;
  const reloadJourney = journey.reload;

  // While a setup runs, its progress is read every few seconds (not while the tab is hidden);
  // the router itself is read again once, when the run ends.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) void reload();
    wasRunning.current = running;
    if (!running) return;
    const timer = setInterval(() => {
      if (!document.hidden) void reloadJourney();
    }, 3000);
    return () => clearInterval(timer);
  }, [running, reloadJourney, reload]);

  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    try {
      await work();
    } catch (e) {
      toast(messageOf(e));
    } finally {
      setBusy("");
    }
  };
  const stage = j?.stage ?? router.stage;
  const [label, kind] = CONDITION[router.condition];
  const at = stage === "connect" ? 0 : stage === "set-up" ? 1 : 2;
  const step = (n: number) => (at > n ? "done" : at === n ? "now" : "");

  return (
    <>
      <Head
        title={router.name}
        sub={[
          router.model,
          router.rosVersion ? `RouterOS ${router.rosVersion}` : "RouterOS read when it connects",
        ]
          .filter(Boolean)
          .join(" · ")}
        crumb={crumb}
      />
      <Panel title="This router">
        <ul className="rows">
          <SettingRow
            title="Status"
            sub={
              router.lastSeenAt
                ? `Last heard from ${when(router.lastSeenAt)}`
                : "Not heard from yet"
            }
            action={<Pill kind={kind}>{label}</Pill>}
          />
          <SettingRow title="Venue" sub={venueName} />
          <SettingRow title="Address" sub={<span className="num">{router.ipAddress}</span>} />
          <SettingRow
            title="Hotspot network"
            sub={<span className="num">{router.networkRange}</span>}
          />
          <SettingRow
            title="Hotspot port"
            sub={router.hotspotInterface ?? "The router's WiFi"}
            action={install ? <Button onClick={() => setPorting(true)}>Change</Button> : null}
          />
          <SettingRow title="Devices online" sub={`${router.connectedDevices} now`} />
          <SettingRow title="Added" sub={longDate(router.createdAt)} />
        </ul>
      </Panel>

      {stage !== "serving" || install ? (
        <Panel title={stage === "serving" ? "Set up" : "Getting it serving"}>
          <ol className="todo checklist">
            <li className={step(0)}>
              <div>
                <h3>Run the script</h3>
                <div className="step-body">
                  {at > 0 ? (
                    <p>Run; the router reached HashiNet through its tunnel.</p>
                  ) : install ? (
                    <p>
                      Reset the MikroTik router with no default configuration, connect to it in
                      WinBox, plug port 1 into the venue&apos;s network, and paste the script into
                      its terminal. It calls HashiNet within a minute and this step ticks itself.
                    </p>
                  ) : (
                    <p>HashiNet&apos;s team runs the router&apos;s setup script at the venue.</p>
                  )}
                  {install && at === 0 && !script ? (
                    <Field
                      label="The ISP router's address"
                      id="rg"
                      hint="Where the router sends its traffic: the venue's internet router, found as the gateway on any device on its network"
                    >
                      <input
                        id="rg"
                        className="input num"
                        inputMode="decimal"
                        value={gateway}
                        onChange={(e) => setGateway(e.target.value)}
                      />
                    </Field>
                  ) : null}
                  {script ? (
                    <>
                      {script.warnings.map((w) => (
                        <p className="note" key={w}>
                          {w}
                        </p>
                      ))}
                      <p className="hint">
                        The script holds this router&apos;s own keys. Getting a new one stops the
                        old one working.
                      </p>
                    </>
                  ) : null}
                </div>
              </div>
              {install && at === 0 ? (
                <div className="actions">
                  {script ? (
                    <>
                      <Button
                        kind="primary"
                        onClick={() => {
                          void navigator.clipboard?.writeText(script.script).catch(() => undefined);
                          toast("Script copied. Paste it once, into this router's terminal.");
                        }}
                      >
                        Copy script
                      </Button>
                      <Button
                        icon="download"
                        onClick={() => {
                          const url = URL.createObjectURL(
                            new Blob([script.script], { type: "text/plain" }),
                          );
                          Object.assign(document.createElement("a"), {
                            href: url,
                            download: `${router.name.replace(/[^A-Za-z0-9-]+/g, "-")}-setup.rsc`,
                          }).click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        Download
                      </Button>
                    </>
                  ) : (
                    <Button
                      kind="primary"
                      busy={busy === "script"}
                      onClick={() =>
                        run("script", async () => {
                          setScript(
                            await api.post<BootstrapScriptResponse>(
                              `/api/routers/${router.id}/bootstrap-script`,
                              { lanPrefix: 24, gatewayIp: gateway.trim() },
                            ),
                          );
                        })
                      }
                    >
                      Get setup script
                    </Button>
                  )}
                  <Button
                    busy={busy === "poll"}
                    onClick={() =>
                      run("poll", async () => {
                        await journey.reload();
                        await reload();
                      })
                    }
                  >
                    Check now
                  </Button>
                </div>
              ) : null}
            </li>
            <li className={step(1)}>
              <div>
                <h3>Set up</h3>
                <div className="step-body">
                  <p>
                    {at > 1
                      ? `Set up${j?.finishedAt ? ` ${when(j.finishedAt)}` : ""}.`
                      : running
                        ? "Setting up. You can leave this page; it keeps going."
                        : "HashiNet configures the hotspot, the portal pages and the walled garden, and reads every change back."}
                  </p>
                  {j && j.phases.length > 0 && (running || j.ok === false) ? (
                    <ul className="rows">
                      {j.phases.map((p) => (
                        <SettingRow
                          key={p.id}
                          title={p.title}
                          sub={p.detail ?? ""}
                          action={<Pill kind={PHASE[p.status][1]}>{PHASE[p.status][0]}</Pill>}
                        />
                      ))}
                    </ul>
                  ) : null}
                  {j?.blockers.map((b) => (
                    <p className="note" key={b.reason}>
                      {b.reason}
                      {b.fix ? ` ${b.fix}` : ""}
                    </p>
                  ))}
                </div>
              </div>
              {install && (at === 1 || stage === "serving") && !running ? (
                <div className="actions">
                  <Button
                    kind={at === 1 ? "primary" : "secondary"}
                    busy={busy === "setup"}
                    onClick={() =>
                      run("setup", async () => {
                        await api.post<RouterJourney>(
                          `/api/routers/${router.id}/setup${stage === "serving" ? "?force=1" : ""}`,
                        );
                        await journey.reload();
                      })
                    }
                  >
                    {stage === "serving" ? "Set up again" : "Set up"}
                  </Button>
                </div>
              ) : null}
            </li>
            <li className={step(2)}>
              <div>
                <h3>Check a phone</h3>
                <div className="step-body">
                  <p>
                    {at > 1
                      ? "Join the WiFi on a phone, see the portal, and get online with a test voucher."
                      : "Once it is set up: join the WiFi on a phone and get online with a test voucher."}
                  </p>
                </div>
              </div>
            </li>
          </ol>
        </Panel>
      ) : null}

      {check && stage !== "connect" ? (
        <Panel
          title="Health"
          right={
            <div className="actions">
              {checks ? (
                <span className="note">
                  {checks.summary.fail
                    ? `${checks.summary.fail} failed`
                    : checks.summary.warn
                      ? `${checks.summary.warn} to look at`
                      : "Every check passed"}
                </span>
              ) : null}
              <Button
                busy={busy === "checks"}
                onClick={() =>
                  run("checks", async () => {
                    setChecks(
                      await api.post<RouterChecks>(
                        `/api/routers/${router.id}/verify?skipWriteTest=1`,
                      ),
                    );
                  })
                }
              >
                Run checks
              </Button>
            </div>
          }
        >
          {checks ? (
            <ul className="rows">
              {checks.checks.map((c) => (
                <SettingRow
                  key={c.id}
                  title={c.title}
                  sub={c.fix ? `${c.detail} ${c.fix}` : c.detail}
                  action={<Pill kind={CHECK[c.status][1]}>{CHECK[c.status][0]}</Pill>}
                />
              ))}
            </ul>
          ) : (
            <p className="muted">
              Checks reach the router through its tunnel and read its hotspot, portal pages, walled
              garden and clock. Nothing changes on it.
            </p>
          )}
        </Panel>
      ) : null}
      {porting ? (
        <HotspotPortDialog
          router={router}
          onClose={() => setPorting(false)}
          onSaved={async () => {
            setPorting(false);
            await reload();
          }}
        />
      ) : null}
      {stage === "serving" && router.tunnelAddress && install ? (
        <p className="muted small">
          Tunnel address <CopyText text={router.tunnelAddress} />
        </p>
      ) : null}
    </>
  );
}

/** Which port the hotspot runs on: the router's WiFi, or a named port on a board without one. */
function HotspotPortDialog({
  router,
  onClose,
  onSaved,
}: {
  router: RouterRecord;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { busy, errors, run } = useSubmit();
  const [port, setPort] = useState(router.hotspotInterface ?? "");
  return (
    <Dialog label="Hotspot port" onClose={onClose}>
      <h2>Hotspot port</h2>
      <p className="muted">It takes effect the next time you run Set up.</p>
      <form
        className="form"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const saved = await run(
            () =>
              api.put(`/api/routers/${router.id}/hotspot-port`, {
                hotspotInterface: port.trim() || null,
              }),
            port.trim() ? `The hotspot runs on ${port.trim()}.` : "The hotspot runs on its WiFi.",
          );
          if (saved) await onSaved();
        }}
      >
        <Field
          label="Port"
          id="hp"
          error={errors.hotspotInterface ? `The port ${errors.hotspotInterface}.` : undefined}
          hint="Leave empty to use the router's WiFi. A board without WiFi names its port, such as ether2"
        >
          <input id="hp" className="input" value={port} onChange={(e) => setPort(e.target.value)} />
        </Field>
        <div className="dialog-actions">
          <Button kind="primary" type="submit" busy={busy}>
            Save
          </Button>
          <Button data-cancel onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
