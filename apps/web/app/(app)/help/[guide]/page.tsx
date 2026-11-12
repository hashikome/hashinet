"use client";

import Link from "next/link";
import { notFound } from "next/navigation";
import { use } from "react";
import { Button, Head, Panel, useToast } from "@/components/hearth/ui";
import { helpFor } from "@/lib/help";
import { useSession } from "@/lib/session";
import { BackHome, GuideRow, ListCard, QuestionRow, StillStuck } from "../parts";

/** One guide, at its own link: its steps, what to do if it goes wrong, and its area's questions. */
export default function GuidePage({ params }: { params: Promise<{ guide: string }> }) {
  const { guide: id } = use(params);
  const { me } = useSession();
  const toast = useToast();
  const { guides, questions } = helpFor(me);
  const g = guides.find((x) => x.id === id);
  if (!g) notFound();
  const related = guides.filter((x) => x.area === g.area && x !== g);
  const common = questions.filter((x) => x.area === g.area);
  return (
    <>
      <Head
        title={g.title}
        sub={g.gist}
        crumb={
          <>
            <Link href="/help">Help</Link> / {g.area}
          </>
        }
        actions={
          <>
            <Button
              onClick={() => {
                void navigator.clipboard?.writeText(window.location.href).catch(() => undefined);
                toast("Link copied");
              }}
            >
              Copy link
            </Button>
            <BackHome />
          </>
        }
      />
      <Panel title="Steps">
        <ol className="howto-page">
          {g.steps.map((step, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: steps are fixed and ordered
            <li key={i}>{step}</li>
          ))}
        </ol>
      </Panel>
      {g.wrong.length ? (
        <Panel title="If it goes wrong">
          <ul className="rows">
            {g.wrong.map(([q, a]) => (
              <li key={q}>
                <div>
                  <b>{q}</b>
                  <span className="sub">{a}</span>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {common.length ? (
        <ListCard title="Frequently asked questions">
          <div className="faqs">
            {common.map((x) => (
              <QuestionRow key={x.q} question={x} />
            ))}
          </div>
        </ListCard>
      ) : null}
      {related.length ? (
        <ListCard title={`More in ${g.area}`}>
          <div className="hrows">
            {related.map((x) => (
              <GuideRow key={x.id} guide={x} />
            ))}
          </div>
        </ListCard>
      ) : null}
      <StillStuck />
    </>
  );
}
