# ADR-0012: The audit log, scoped like everything else

Status: accepted, 4 November 2026. Follows ntumie.'s audit log (its ADR-0015 and ADR-0021).

## Context

The admin showed "recent activity" as loose sentences, and `audit_logs` stored a staff id, a free
action string and arbitrary JSON metadata. With businesses, owners, managers and operators
(ADR-0011), people need to answer "who changed this, when, and what did it do?" for their own
scope, and HashiFi's team for everything, from evidence rather than prose.

## Decision

- **One append-only `audit_logs` table**, written in the same transaction as the change; if the
  audit write fails, the change rolls back. Rows are never edited or deleted by the application.
- **Each row records:** time (database, UTC), actor (membership id and user id, or null for the
  system), business id and venue id when the event belongs to one, a typed action from a closed union
  in `@hashifi/types` (`router.offline`, `package.price.set`, `voucher.print`, `member.invite`,
  `auth.sign_in.failed`, ...), its category (`change`, `read` or `auth`), the target's type and id,
  the outcome (`success`, `no_change`, `failed` or `denied`), and a bounded change: before and after
  values validated per action (a status, a price, a role, a count). No free JSON, no names, emails,
  voucher codes, tokens or IP addresses in the change.
- **Labels are read, not stored.** The API resolves actor and target labels (a person's current
  name, a venue's current name) when it answers; ids stay the evidence.
- **Scope comes from the principal** (ADR-0011): platform roles see everything, or one business when
  the scope filter is set; a business owner sees the business; a manager sees their venues; operators
  have no audit log. Platform-only events (a platform member's authenticator reset) belong to no
  business.
- **Reads that reveal something are recorded** (showing voucher codes, opening the audit log) and
  hidden by default behind "Include read events".
- **One page, `Audit log`:** Timestamp (`YYYY-MM-DD HH:mm:ss`, East Africa Time), Actor with role,
  Action, Target, Outcome, Change. Filters: one Search across those columns, Action, From and To,
  Include read events, Apply filters, and Clear filters once applied. Cursor pagination with Load
  more; the API filters before it paginates. The overview's "Recent activity" is the latest six
  actions from the same API, linking to the page.

## Consequences

Every service that changes state calls the audit writer with a typed action and its bounded change;
a new action needs its type and validation first. The existing `audit_logs` model is replaced in the
new baseline (business-scopes M1). Retention: kept while the business exists; sign-in events for 90
days.
