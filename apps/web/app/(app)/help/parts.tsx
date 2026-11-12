"use client";

import Link from "next/link";
import { SUPPORT_EMAIL } from "@/components/hearth/auth-frame";
import { Icon } from "@/components/hearth/icons";
import { ButtonLink } from "@/components/hearth/ui";
import type { Guide, Question } from "@/lib/help";
import { homeOf } from "@/lib/nav";
import { useSession } from "@/lib/session";

/** Back to where the reader works. */
export function BackHome() {
  const { me } = useSession();
  return (
    <ButtonLink href={homeOf(me)}>
      Back to {me.active.scope === "platform" ? "Businesses" : "Overview"}
    </ButtonLink>
  );
}

/** A guide as a row you tap anywhere: its title and its one line. */
export function GuideRow({ guide, hidden = false }: { guide: Guide; hidden?: boolean }) {
  return (
    <Link className="hrow" href={`/help/${guide.id}`} hidden={hidden}>
      <span>
        <b>{guide.title}</b>
        <span className="sub">{guide.gist}</span>
      </span>
    </Link>
  );
}

/**
 * A question that opens in place; one open at a time (details sharing a name), and a tap on the
 * answer closes it too, unless the reader is selecting its text.
 */
export function QuestionRow({
  question,
  open = false,
  hidden = false,
}: {
  question: Question;
  open?: boolean;
  hidden?: boolean;
}) {
  return (
    <details className="faq" name="help-faq" open={open} hidden={hidden}>
      <summary>
        <span>{question.q}</span>
        <Icon name="plus" size={16} />
      </summary>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the summary is the keyboard's control */}
      <p
        onClick={(e) => {
          if (!String(getSelection()))
            (e.currentTarget.parentElement as HTMLDetailsElement).open = false;
        }}
      >
        {question.a}
      </p>
    </details>
  );
}

/** A list of like rows, its heading above the card, so it never reads as one of the rows. */
export function ListCard({
  title,
  children,
  hidden = false,
}: {
  title: string;
  children: React.ReactNode;
  hidden?: boolean;
}) {
  return (
    <section className="help-list" hidden={hidden}>
      <h2>{title}</h2>
      <div className="panel">{children}</div>
    </section>
  );
}

export function StillStuck() {
  const { me } = useSession();
  if (me.active.scope === "platform") return null;
  return (
    <section className="panel help-contact">
      <div>
        <h2>Still stuck?</h2>
        <p className="muted">Write to HashiNet&apos;s support. The reply comes to your email.</p>
      </div>
      <a
        className="btn secondary"
        href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Help with ${me.active.business?.name ?? "HashiNet"}`)}`}
      >
        <span>Contact support</span>
      </a>
    </section>
  );
}
