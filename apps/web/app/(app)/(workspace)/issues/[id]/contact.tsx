"use client";

import type { IssueDetail } from "@hashinet/types";
import { CopyText } from "@/components/hearth/ui";

/** The business's owner, to call or email: both copy when clicked, and a number calls on a phone. */
export function Contact({ contact }: { contact: NonNullable<IssueDetail["contact"]> }) {
  return (
    <span className="setup-contact">
      <b>{contact.name}</b> · <CopyText text={contact.email} />
      {contact.phone ? (
        <>
          {" · "}
          <a className="link" href={`tel:${contact.phone.replace(/\s/g, "")}`}>
            {contact.phone}
          </a>
        </>
      ) : null}
    </span>
  );
}
