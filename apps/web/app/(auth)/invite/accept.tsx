"use client";

import {
  type AcceptBusinessInvitation,
  type AcceptedInvitation,
  type InvitationPreview,
  REGIONS,
  type Region,
} from "@hashinet/types";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { AuthFrame } from "@/components/hearth/auth-frame";
import { OtpBoxes, otpComplete } from "@/components/hearth/ui";
import { ApiRequestError, api, messageOf } from "@/lib/api";

const STEPS = ["You", "Business", "Venue"] as const;
const TITLES = ["About you", "Your business", "Your first venue"];

interface Values {
  name: string;
  phone: string;
  business: string;
  businessRegion: Region | "";
  businessArea: string;
  venue: string;
  venueRegion: Region | "";
  venueArea: string;
  same: boolean;
}

/** Which step holds each field the API may refuse, so a refusal opens that step. */
const STEP_OF: Record<string, number> = {
  "person.name": 0,
  "person.phone": 0,
  "business.name": 1,
  "business.region": 1,
  "business.area": 1,
  "venue.name": 2,
  "venue.region": 2,
  "venue.area": 2,
};

/**
 * Accepting an invitation to start a business (prototype `inviteAccept`): you, the business and its
 * first venue, saved only at the end; then the owner signs in with a code like everyone. The token
 * is in the link's fragment and goes to the API in a request body, never in an address.
 */
export function AcceptInvitation() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [invite, setInvite] = useState<InvitationPreview | null>(null);
  const [gone, setGone] = useState(false);
  const [step, setStep] = useState(0);
  const [v, setV] = useState<Values>({
    name: "",
    phone: "",
    business: "",
    businessRegion: "",
    businessArea: "",
    venue: "",
    venueRegion: "",
    venueArea: "",
    same: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<AcceptedInvitation | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");

  // Read once: the token then leaves the address bar, so it isn't kept in history or shared by
  // mistake (and React may run this effect twice in development).
  const read = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (read.current === undefined) {
      read.current = new URLSearchParams(window.location.hash.slice(1)).get("token");
      window.history.replaceState(null, "", window.location.pathname);
    }
    const found = read.current;
    if (!found) return setGone(true);
    setToken(found);
    api
      .post<InvitationPreview>("/api/invitations/accept/preview", { token: found })
      .then(setInvite)
      .catch(() => setGone(true));
  }, []);

  const set = (key: keyof Values) => (e: { target: { value: string } }) =>
    setV((now) => ({ ...now, [key]: e.target.value }));

  /** What the person typed missing on this step, before asking the API. */
  const missing = (at: number): Record<string, string> => {
    const need: [string, string, string][] =
      at === 0
        ? [
            ["person.name", v.name, "Your name is required."],
            ["person.phone", v.phone, "Your mobile number is required."],
          ]
        : at === 1
          ? [
              ["business.name", v.business, "The business name is required."],
              ["business.region", v.businessRegion, "Choose a region."],
              ["business.area", v.businessArea, "The area or street is required."],
            ]
          : [
              ["venue.name", v.venue, "The venue name is required."],
              ["venue.region", v.same ? v.businessRegion : v.venueRegion, "Choose a region."],
              [
                "venue.area",
                v.same ? v.businessArea : v.venueArea,
                "The area or street is required.",
              ],
            ];
    return Object.fromEntries(need.filter(([, value]) => !value.trim()).map(([k, , m]) => [k, m]));
  };

  async function next(e: FormEvent) {
    e.preventDefault();
    const problems = missing(step);
    setErrors(problems);
    if (Object.keys(problems).length) return;
    if (step < STEPS.length - 1) {
      if (step === 1 && !v.venue) setV((now) => ({ ...now, venue: now.business }));
      return setStep(step + 1);
    }
    if (!token) return;
    setBusy(true);
    try {
      const body: AcceptBusinessInvitation = {
        token,
        person: { name: v.name, phone: v.phone },
        business: { name: v.business, region: v.businessRegion as Region, area: v.businessArea },
        venue: {
          name: v.venue,
          region: (v.same ? v.businessRegion : v.venueRegion) as Region,
          area: v.same ? v.businessArea : v.venueArea,
        },
      };
      const done = await api.post<AcceptedInvitation>("/api/invitations/accept/business", body);
      await api.post("/api/auth/email-otp/send-verification-otp", {
        email: done.email,
        type: "sign-in",
      });
      setCreated(done);
    } catch (err) {
      if (err instanceof ApiRequestError && err.details) {
        const found = Object.fromEntries(
          Object.entries(err.details).map(([k, m]) => [k, `This ${m}.`]),
        );
        setErrors(found);
        const first = Math.min(...Object.keys(found).map((k) => STEP_OF[k] ?? step));
        setStep(first);
      } else if (err instanceof ApiRequestError && err.status === 404) {
        setGone(true);
      } else setErrors({ form: messageOf(err) });
    } finally {
      setBusy(false);
    }
  }

  async function signIn(e: FormEvent) {
    e.preventDefault();
    if (!created) return;
    if (!otpComplete(code)) return setCodeError("Enter all 6 digits.");
    setBusy(true);
    setCodeError("");
    try {
      await api.post("/api/auth/sign-in/email-otp", { email: created.email, otp: code });
      router.replace("/overview");
    } catch {
      setCodeError("That code didn't work. Check it, or sign in from the sign-in page.");
    } finally {
      setBusy(false);
    }
  }

  if (gone) {
    return (
      <AuthFrame>
        <h1>This invitation can&apos;t be used</h1>
        <p className="lead">
          It has expired, been used, or was replaced by a newer one. Ask whoever invited you to send
          it again. If you already accepted it, sign in.
        </p>
        <a className="btn primary big" href="/sign-in">
          Sign in
        </a>
      </AuthFrame>
    );
  }
  if (!invite) return <AuthFrame>{null}</AuthFrame>;

  if (created) {
    return (
      <AuthFrame>
        <h1>Check your email</h1>
        <p className="lead">
          {v.business} is created. To sign in, enter the code we sent to <b>{created.email}</b>.
        </p>
        <form className="form" noValidate onSubmit={signIn}>
          <OtpBoxes
            label="Code from the email"
            hiddenLabel
            value={code}
            onChange={setCode}
            error={codeError}
          />
          <button className="btn primary big" type="submit" disabled={busy}>
            Sign in
          </button>
        </form>
      </AuthFrame>
    );
  }

  const field = (
    id: string,
    label: string,
    key: keyof Values,
    error: string | undefined,
    extra: React.InputHTMLAttributes<HTMLInputElement> = {},
    hint?: string,
  ) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        type="text"
        value={String(v[key])}
        onChange={set(key)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-note` : undefined}
        {...extra}
      />
      {error ? (
        <div className="hint danger" id={`${id}-note`}>
          {error}
        </div>
      ) : hint ? (
        <div className="hint" id={`${id}-note`}>
          {hint}
        </div>
      ) : null}
    </div>
  );
  const place = (
    prefix: "business" | "venue",
    title: string,
    hint: string | null,
    disabled = false,
  ) => {
    const region = prefix === "business" ? "businessRegion" : "venueRegion";
    const area = prefix === "business" ? "businessArea" : "venueArea";
    const shownRegion = disabled ? v.businessRegion : v[region];
    const shownArea = disabled ? v.businessArea : v[area];
    return (
      <div className="group">
        <h3>{title}</h3>
        {hint ? <p className="hint">{hint}</p> : null}
        <div className="field">
          <label htmlFor={`${prefix}-r`}>Region</label>
          <select
            id={`${prefix}-r`}
            className="input"
            value={shownRegion}
            disabled={disabled}
            onChange={set(region)}
            aria-invalid={errors[`${prefix}.region`] ? true : undefined}
          >
            <option value="" disabled>
              Choose a region
            </option>
            {REGIONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          {errors[`${prefix}.region`] ? (
            <div className="hint danger">{errors[`${prefix}.region`]}</div>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-a`}>Area or street</label>
          <input
            id={`${prefix}-a`}
            className="input"
            type="text"
            placeholder="Mjimwema, Kigamboni"
            value={shownArea}
            disabled={disabled}
            onChange={set(area)}
            aria-invalid={errors[`${prefix}.area`] ? true : undefined}
          />
          <div className={`hint${errors[`${prefix}.area`] ? " danger" : ""}`}>
            {errors[`${prefix}.area`] ?? "A street, or a landmark and area"}
          </div>
        </div>
      </div>
    );
  };

  return (
    <AuthFrame>
      <ol className="inv-steps">
        {STEPS.map((title, i) => (
          <li
            key={title}
            className={i < step ? "done" : i === step ? "now" : ""}
            aria-current={i === step ? "step" : undefined}
          >
            <span>{i < step ? "✓" : i + 1}</span>
            {title}
          </li>
        ))}
      </ol>
      <h1>{TITLES[step]}</h1>
      {step === 0 ? (
        <p className="lead">
          HashiNet invited <b>{invite.email}</b> to run a business on HashiNet.
        </p>
      ) : null}
      <form className="form" noValidate onSubmit={next}>
        {step === 0 ? (
          <>
            {field("inv-n", "Your full name", "name", errors["person.name"], {
              autoComplete: "name",
              placeholder: "Baraka Mollel",
            })}
            {field(
              "inv-m",
              "Mobile number",
              "phone",
              errors["person.phone"],
              { type: "tel", autoComplete: "tel", placeholder: "0754 300 118", inputMode: "tel" },
              "HashiNet's team calls you on this to plan your setup",
            )}
          </>
        ) : step === 1 ? (
          <>
            {field(
              "inv-b",
              "Business name",
              "business",
              errors["business.name"],
              { autoComplete: "organization", placeholder: "Bahari Beach Bar" },
              "As your guests know it",
            )}
            {place(
              "business",
              "Business address",
              "Where the business is registered, for its bills",
            )}
          </>
        ) : (
          <>
            {field(
              "inv-v",
              "Venue name",
              "venue",
              errors["venue.name"],
              { placeholder: "Bahari Beach Bar" },
              "Keep the business name if there is one place",
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={v.same}
                onChange={(e) => setV((now) => ({ ...now, same: e.target.checked }))}
              />{" "}
              <span>The venue is at the business address</span>
            </label>
            {place("venue", "Venue location", null, v.same)}
          </>
        )}
        {errors.form ? (
          <p className="danger" role="alert">
            {errors.form}
          </p>
        ) : null}
        <div className="inv-nav">
          {step ? (
            <button className="btn big" type="button" onClick={() => setStep(step - 1)}>
              Back
            </button>
          ) : null}
          <button className="btn primary big" type="submit" disabled={busy}>
            {step === STEPS.length - 1 ? "Create business" : "Continue"}
          </button>
        </div>
      </form>
      {step === 0 ? (
        <p className="auth-terms auth-rule">
          Not you, or not expecting this? Ignore it: nothing is created unless you finish.
        </p>
      ) : null}
    </AuthFrame>
  );
}
