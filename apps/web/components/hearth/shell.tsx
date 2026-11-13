"use client";

import type { IssueCount, Me, VenueRecord } from "@hashinet/types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { api, messageOf } from "@/lib/api";
import { homeOf, type NavEntry, navOf, ROLE_NAME } from "@/lib/nav";
import { useSession } from "@/lib/session";
import { useVenues } from "@/lib/venues";
import { BusinessMark, Icon, Mark } from "./icons";
import { useToast } from "./ui";

/** HashiNet's own spaces, the person's in every workspace: Help, and Account and security. */
export type Space = "Help" | "Account";
const SPACE_HREF: Record<Space, string> = { Help: "/help", Account: "/account" };

/** The brand at the top of the menu: the business, the platform, or one of HashiNet's spaces. */
function Brand({ me, space, size = 30 }: { me: Me; space?: Space; size?: number }) {
  if (space) {
    return (
      <Link className="brand" href={SPACE_HREF[space]} aria-label={space}>
        <Mark size={size} />
        <span className="platform-tag">{space}</span>
      </Link>
    );
  }
  const business = me.active.business;
  if (!business) {
    return (
      <Link className="brand" href={homeOf(me)} aria-label="HashiNet platform, home">
        <Mark size={size} />
        <span className="platform-tag">Platform</span>
      </Link>
    );
  }
  return (
    <Link className="brand" href={homeOf(me)} aria-label={`${business.name}, overview`}>
      <BusinessMark name={business.name} size={size === 30 ? 28 : size} />
      <span className={`brand-name${business.name.length > 12 ? " long" : ""}`}>
        {business.name}
      </span>
    </Link>
  );
}

/** The person, their workspaces (switching is audited), their spaces, and signing out. */
function AccountMenu({ me }: { me: Me }) {
  const { switchTo, signOut } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const initials = me.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <div className="foot" ref={root}>
      {open ? (
        <div className="menu" role="menu">
          <div className="menu-label">Workspaces</div>
          {me.memberships.map((m) => {
            const here = m.id === me.active.id;
            return (
              <button
                key={m.id}
                className="ws"
                type="button"
                role="menuitemradio"
                aria-checked={here}
                onClick={() => {
                  setOpen(false);
                  if (!here) switchTo(m.id).catch((e) => toast(messageOf(e)));
                }}
              >
                {m.business ? (
                  <BusinessMark name={m.business.name} size={32} />
                ) : (
                  <Mark size={32} />
                )}
                <span className="t">
                  <b>{m.business?.name ?? "HashiNet platform"}</b>
                  <small>{ROLE_NAME[m.role]}</small>
                </span>
                {here ? <Icon name="check" /> : null}
              </button>
            );
          })}
          <hr />
          <Link
            className="menu-item"
            role="menuitem"
            href="/account"
            onClick={() => setOpen(false)}
          >
            Account and security
          </Link>
          <Link className="menu-item" role="menuitem" href="/help" onClick={() => setOpen(false)}>
            Help
          </Link>
          <button
            className="menu-item"
            role="menuitem"
            type="button"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      ) : null}
      <button
        className="acct"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar">{initials}</span>
        <span>
          <span>
            <b>{me.name}</b>
          </span>
          <span className="sub">{ROLE_NAME[me.active.role]}</span>
        </span>
        <Icon name="updown" size={14} />
      </button>
      {me.active.scope === "business" ? (
        <div className="credit">
          <Mark size={14} />
          <span>Runs on HashiNet</span>
        </div>
      ) : null}
    </div>
  );
}

/** Open issues in the workspace, for the count beside Issues; asked again on each page. */
function useOpenIssues(me: Me): number {
  const path = usePathname();
  const [count, setCount] = useState(0);
  const reads = me.active.capabilities.includes("issue.read");
  // biome-ignore lint/correctness/useExhaustiveDependencies: asked again on each page
  useEffect(() => {
    if (!reads) return;
    let live = true;
    api
      .get<IssueCount>("/api/issues/count")
      .then((l) => live && setCount(l.openCount))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [reads, me.active.id, path]);
  return reads ? count : 0;
}

function NavList({
  entries,
  label,
  openIssues,
}: {
  entries: NavEntry[];
  label: string;
  openIssues: number;
}) {
  const path = usePathname();
  // A space's first link is its own root, so it is on only there.
  const isOn = (href: string) =>
    path === href ||
    (path.startsWith(`${href}/`) &&
      !entries.some((e) => "href" in e && e.href !== href && path.startsWith(e.href)));
  const current = entries.find((e) => "links" in e && e.links.some((l) => isOn(l.href)));
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const shown = openGroup ?? (current && "links" in current ? current.label : "");
  return (
    <nav className="nav" aria-label={label}>
      {entries.map((entry) => {
        if ("heading" in entry) {
          return (
            <div className="nav-group" key={`h-${entry.heading}`}>
              {entry.heading}
            </div>
          );
        }
        if ("links" in entry) {
          const open = entry.label === shown;
          return (
            <div key={entry.label}>
              <button
                type="button"
                className={`has-sub${open ? " open" : ""}${!open && entry === current ? " here" : ""}`}
                aria-expanded={open}
                onClick={() => setOpenGroup(open ? "" : entry.label)}
              >
                <Icon name={entry.icon} />
                <span>{entry.label}</span>
                <Icon name="chevron" size={14} />
              </button>
              {open ? (
                <div className="subnav">
                  {entry.links.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      className={isOn(l.href) ? "on" : ""}
                      aria-current={isOn(l.href) ? "page" : undefined}
                    >
                      {l.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          );
        }
        const on = isOn(entry.href);
        return (
          <Link
            key={entry.href}
            href={entry.href}
            className={on ? "on" : ""}
            aria-current={on ? "page" : undefined}
          >
            {entry.icon ? <Icon name={entry.icon} /> : null}
            <span>{entry.label}</span>
            {entry.href === "/issues" && openIssues > 0 ? (
              <span className="count">
                {openIssues}
                <span className="sr-only"> open</span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The frame every signed-in page stands on (prototype app.js): a menu column with the brand, the
 * venue filter, the menu and the account menu; on a phone a top bar opens it.
 */
export function Shell({
  me,
  venues = [],
  space,
  nav,
  children,
}: {
  me: Me;
  venues?: VenueRecord[];
  /** Help and Account and security stand on the same frame, as HashiNet's own. */
  space?: Space;
  /** A space's own menu, in place of the workspace's. */
  nav?: NavEntry[];
  children: ReactNode;
}) {
  const path = usePathname();
  const [side, setSide] = useState(false);
  // A page change closes the phone's menu.
  // biome-ignore lint/correctness/useExhaustiveDependencies: closes on every path change
  useEffect(() => setSide(false), [path]);
  const entries = nav ?? navOf(me, venues);
  const openIssues = useOpenIssues(me);
  const { filter, setFilter } = useVenues();
  return (
    <div
      className={`app${space ? " help-app" : ""}${space === "Account" ? " acct-page" : ""}${side ? " open" : ""}`}
    >
      <aside className="side">
        <Brand me={me} space={space} />
        {!space && me.active.scope === "business" && venues.length > 0 ? (
          <div className="switcher">
            <select
              aria-label="Filter by venue"
              value={venues.length > 1 ? filter : venues[0]?.id}
              onChange={(e) => setFilter(e.target.value)}
            >
              {venues.length > 1 ? <option value="all">All venues</option> : null}
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <Icon name="chev" size={14} />
          </div>
        ) : null}
        <NavList
          entries={entries}
          openIssues={space ? 0 : openIssues}
          label={space === "Account" ? "Account and security" : (space ?? "Main")}
        />
        <AccountMenu me={me} />
      </aside>
      {/* A tap outside the open menu closes it. */}
      {side ? (
        <button
          type="button"
          className="side-scrim"
          aria-label="Close menu"
          onClick={() => setSide(false)}
        />
      ) : null}
      <div>
        <div className="topbar">
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={side}
            onClick={() => setSide(true)}
          >
            <Icon name="menu" size={20} />
          </button>
          <Brand me={me} space={space} size={24} />
        </div>
        <main className="canvas" id="main">
          {children}
        </main>
      </div>
    </div>
  );
}
