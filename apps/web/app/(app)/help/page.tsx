"use client";

import { useState } from "react";
import { Head } from "@/components/hearth/ui";
import { helpFor } from "@/lib/help";
import { useSession } from "@/lib/session";
import { BackHome, GuideRow, ListCard, QuestionRow, StillStuck } from "./parts";

/** Start here: a search over the guides and questions, and the questions people ask most. */
export default function HelpHome() {
  const { me } = useSession();
  const { guides, questions } = helpFor(me);
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (text: string) => words.every((w) => text.toLowerCase().includes(w));
  const guideHits = guides.filter((g) =>
    hit(
      [
        g.title,
        g.gist,
        g.area,
        ...questions.filter((x) => x.area === g.area).map((x) => `${x.q} ${x.a}`),
      ].join(" "),
    ),
  );
  const questionHits = questions.filter((x) => hit(`${x.q} ${x.a} ${x.area}`));
  const searching = words.length > 0;
  const who =
    me.active.scope === "platform"
      ? "HashiNet's team"
      : `owners at ${me.active.business?.name ?? "your business"}`;
  return (
    <>
      <Head
        title="How can we help?"
        sub={`Guides for ${who}, and answers to what people ask most.`}
        actions={<BackHome />}
      />
      <input
        className="search help-search"
        type="search"
        placeholder="Search guides and questions"
        aria-label="Search guides and questions"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {searching && !guideHits.length && !questionHits.length ? (
        <p className="muted">Nothing matches. Try other words, or contact support.</p>
      ) : null}
      <ListCard title="Guides" hidden={!searching || !guideHits.length}>
        <div className="hrows">
          {guideHits.map((g) => (
            <GuideRow key={g.id} guide={g} />
          ))}
        </div>
      </ListCard>
      <ListCard title="Frequently asked questions" hidden={searching && !questionHits.length}>
        <div className="faqs">
          {(searching ? questionHits : questions.slice(0, 6)).map((x, i) => (
            <QuestionRow key={x.q} question={x} open={i === 0} />
          ))}
        </div>
      </ListCard>
      <StillStuck />
    </>
  );
}
