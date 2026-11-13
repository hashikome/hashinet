import type {
  IssueAction,
  IssueCount,
  IssueDetail,
  IssueEventData,
  IssueList,
  IssueMoved,
  IssuePerson,
  IssueRecord,
  MembershipRole,
} from "@hashinet/types";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import type { Principal } from "../access/principal.js";
import { outranks } from "../access/rank.js";
import { businessDayOf } from "../analytics/business-day.js";
import { PrismaService } from "../database/prisma.service.js";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import type { IssueKind } from "../generated/prisma/enums.js";
import { apiError } from "../http/error-envelope.js";
import { oneLine } from "../http/validation.js";
import { captureFailure } from "../observability/telemetry.js";
import { JOURNEY_SELECT, routerCondition } from "../routers/router-journey.js";

const DAY_MS = 86_400_000;

/** HashiNet's own workspace. */
export const PLATFORM_WORKSPACE = { scope: "platform", businessId: null } as const;
type Workspace = { scope: "platform" | "business"; businessId: string | null };

/** The kinds an issue can be handed to a platform operator in: a venue's package is for the
 * admin and managers only (ADR-0013, 2). */
const PLATFORM_KINDS_FOR_OPERATORS: IssueKind[] = ["router_offline", "venue_setup"];

type Db = Prisma.TransactionClient;

export const handInput = z.object({ to: z.uuid(), note: oneLine(500).nullable().default(null) });
export const takeOverInput = z.object({ reason: oneLine(500).min(1, "is required") });
export const noteInput = z.object({ note: oneLine(500).min(1, "is required") });
export const listQuery = z.object({
  status: z.enum(["open", "resolved", "all"]).default("open"),
  /** One business's issues, as its page lists them. */
  businessId: z.uuid().nullable().default(null),
});

const notFound = () => new NotFoundException(apiError("NOT_FOUND", "No such issue."));
const heldByOther = () =>
  new ForbiddenException(
    apiError("FORBIDDEN", "Someone else is responsible for this issue. Take it over to act."),
  );

const include = {
  business: { select: { id: true, name: true } },
  venue: {
    select: {
      id: true,
      name: true,
      business: { select: { id: true, name: true } },
      // A setup stalls by its date (ADR-0011, 11).
      onboarding: { select: { setupDate: true } },
      routers: { select: { lastSeenAt: true, status: true } },
    },
  },
  router: { select: { id: true, name: true } },
  holder: { include: { user: { select: { name: true } } } },
  events: { orderBy: { at: "desc" }, take: 1, select: { at: true } },
} as const satisfies Prisma.IssueInclude;

type Row = Prisma.IssueGetPayload<{ include: typeof include }>;

/** Who may hold an issue for a move: nobody, the reader, or a named holder. */
type Holder = { is: "nobody" } | { is: "reader" } | { is: "nobody_or_reader" } | { is: string };

/** An event on an issue's log: who did what, to whom, with what note or facts. */
interface Event {
  action: IssueAction;
  actorId: string | null;
  toId: string | null;
  note: string | null;
  data: IssueEventData | null;
}

/**
 * Issues (redesign-admin, Issues; ADR-0011, 11): everything that needs someone, kept per workspace.
 * Someone claims an issue (or acting first does), releases it or hands it on; only someone above
 * the holder takes it over, with a reason. Every step is on its log. Router issues come and go with
 * the router's state; the others are opened and resolved by the journeys they belong to.
 */
@Injectable()
export class IssuesService {
  constructor(private readonly db: PrismaService) {}

  async list(staff: Principal, query: z.infer<typeof listQuery>): Promise<IssueList> {
    const { status, businessId } = query;
    // A platform issue belongs to a business through its venue.
    const where: Prisma.IssueWhereInput = {
      AND: [
        this.inReach(staff),
        businessId ? { OR: [{ businessId }, { venue: { businessId } }] } : {},
      ],
    };
    const [rows, count] = await Promise.all([
      this.db.issue.findMany({
        where: { ...where, ...(status === "all" ? {} : { status }) },
        include,
        orderBy: [{ status: "asc" }, { openedAt: "desc" }],
        take: 200,
      }),
      this.count(staff),
    ]);
    return { issues: rows.map((row) => this.record(staff, row)), openCount: count.openCount };
  }

  /** The open issues in the reader's reach, for the menu. */
  async count(staff: Principal): Promise<IssueCount> {
    return {
      openCount: await this.db.issue.count({ where: { ...this.inReach(staff), status: "open" } }),
    };
  }

  async detail(staff: Principal, id: string): Promise<IssueDetail> {
    const row = await this.row(staff, id);
    const open = row.status === "open";
    const schedules =
      open && row.kind === "venue_package" && (staff.role === "admin" || staff.role === "manager");
    const [events, people, goesTo, owner] = await Promise.all([
      this.db.issueEvent.findMany({
        where: { issueId: id },
        include: {
          actor: { include: { user: { select: { name: true } } } },
          to: { include: { user: { select: { name: true } } } },
        },
        orderBy: [{ at: "asc" }, { id: "asc" }],
      }),
      open ? this.workspacePeople(staff, row.kind, row.venueId) : [],
      schedules ? this.workspacePeople(staff, "venue_setup", row.venueId) : [],
      staff.scope === "platform" && row.venueId
        ? this.db.membership.findFirst({
            where: {
              role: "owner",
              status: "active",
              business: { venues: { some: { id: row.venueId } } },
            },
            select: { user: { select: { name: true, email: true, phone: true } } },
          })
        : null,
    ]);
    return {
      issue: this.record(staff, row),
      events: events.map((e) => ({
        at: e.at.toISOString(),
        actor: e.actor ? person(e.actor) : null,
        action: e.action as IssueAction,
        to: e.to ? person(e.to) : null,
        note: e.note,
        data: (e.data ?? null) as IssueEventData | null,
      })),
      handTo: people.filter((p) => p.membershipId !== staff.membershipId),
      goesTo,
      contact: owner ? owner.user : null,
    };
  }

  async claim(staff: Principal, id: string): Promise<IssueDetail> {
    const row = await this.openRow(staff, id);
    if (row.holderId !== staff.membershipId) {
      await this.move(id, { is: "nobody" }, staff.membershipId, [event(staff, "claimed")]);
    }
    return this.detail(staff, id);
  }

  /** Gives the issue back; an operator no longer sees it then. */
  async release(staff: Principal, id: string): Promise<IssueMoved> {
    await this.openRow(staff, id);
    await this.move(id, { is: "reader" }, null, [event(staff, "released")], staff.membershipId);
    return { visible: this.keepsSight(staff) };
  }

  /** The holder, or anyone while nobody holds it, hands it to someone else in the workspace. */
  async hand(staff: Principal, id: string, input: z.infer<typeof handInput>): Promise<IssueMoved> {
    const row = await this.openRow(staff, id);
    const people = await this.workspacePeople(staff, row.kind, row.venueId);
    if (input.to === staff.membershipId || !people.some((p) => p.membershipId === input.to)) {
      throw new BadRequestException(
        apiError("VALIDATION_FAILED", "Check the highlighted fields.", {
          to: "must be someone else who can work on it",
        }),
      );
    }
    await this.move(
      id,
      { is: "nobody_or_reader" },
      input.to,
      [{ ...event(staff, "handed"), note: input.note, toId: input.to }],
      staff.membershipId,
    );
    return { visible: this.keepsSight(staff) };
  }

  /** Someone above the holder takes it over, with a reason the holder sees. */
  async takeOver(
    staff: Principal,
    id: string,
    input: z.infer<typeof takeOverInput>,
  ): Promise<IssueDetail> {
    const row = await this.openRow(staff, id);
    if (!row.holder || row.holderId === staff.membershipId) {
      throw new ConflictException(apiError("CONFLICT", "Nobody else holds this issue."));
    }
    if (!outranks(staff.role, row.holder.role)) {
      throw new ForbiddenException(
        apiError("FORBIDDEN", "Only someone above them takes an issue over."),
      );
    }
    await this.move(id, { is: row.holder.id }, staff.membershipId, [
      { ...event(staff, "taken_over"), note: input.reason },
    ]);
    return this.detail(staff, id);
  }

  /** A note on its log. Acting first claims an issue nobody holds. */
  async note(staff: Principal, id: string, input: z.infer<typeof noteInput>): Promise<IssueDetail> {
    const row = await this.openRow(staff, id);
    const noted = { ...event(staff, "noted"), note: input.note };
    await this.move(
      id,
      { is: "nobody_or_reader" },
      staff.membershipId,
      row.holderId === null ? [event(staff, "claimed"), noted] : [noted],
      staff.membershipId,
    );
    return this.detail(staff, id);
  }

  /**
   * Gives back every issue a removed person holds, so the rest of their team can pick them up;
   * the log says who removed them.
   */
  async releaseAllHeldBy(holderId: string, by: Principal, db: Db): Promise<void> {
    const held = await db.issue.findMany({
      where: { holderId, status: "open" },
      select: { id: true },
    });
    if (held.length === 0) return;
    await db.issue.updateMany({ where: { holderId, status: "open" }, data: { holderId: null } });
    await db.issueEvent.createMany({
      data: held.map((i) => ({
        issueId: i.id,
        ...event(by, "released"),
        data: { reason: "holder_removed" },
      })),
    });
  }

  /**
   * Keeps router issues in step with the routers: a router that has served and stopped answering
   * opens one in the platform's workspace and in its business's; serving again, or the router
   * being removed, resolves both. A router still being set up raises none.
   */
  async syncRouterIssues(): Promise<void> {
    const [routers, open] = await Promise.all([
      this.db.router.findMany({
        select: {
          id: true,
          venueId: true,
          venue: { select: { businessId: true } },
          ...JOURNEY_SELECT,
        },
      }),
      this.db.issue.findMany({
        where: { kind: "router_offline", status: "open" },
        select: { scope: true, businessId: true, key: true },
      }),
    ]);
    const openKeys = new Set(open.map((i) => `${i.scope}|${i.businessId}|${i.key}`));
    const down = new Map<string, (typeof routers)[number]>();
    for (const r of routers) {
      const condition = routerCondition(r);
      if (condition === "offline" || condition === "needs-attention") down.set(`router:${r.id}`, r);
    }
    for (const [key, r] of down) {
      for (const workspace of [
        PLATFORM_WORKSPACE,
        { scope: "business" as const, businessId: r.venue.businessId },
      ]) {
        if (openKeys.has(`${workspace.scope}|${workspace.businessId}|${key}`)) continue;
        await this.open({
          ...workspace,
          kind: "router_offline",
          key,
          venueId: r.venueId,
          routerId: r.id,
          holderId: null,
        }).catch(captureFailure);
      }
    }
    const present = new Set(routers.map((r) => `router:${r.id}`));
    for (const i of open) {
      if (down.has(i.key)) continue;
      const reason = present.has(i.key) ? "serving" : "router_removed";
      await this.resolve(i, i.key, { reason }).catch(captureFailure);
    }
  }

  /** Opens an issue unless one is open for its key in the workspace; idempotent. */
  open(input: IssueOpening, db: Db = this.db): Promise<void> {
    return openIssue(db, input);
  }

  /** Resolves the open issue for a key in a workspace, if there is one, with why it ended. */
  async resolve(
    workspace: Workspace,
    key: string,
    why: IssueEventData,
    db: Db = this.db,
  ): Promise<void> {
    const found = await db.issue.findFirst({
      where: { scope: workspace.scope, businessId: workspace.businessId, key, status: "open" },
      select: { id: true },
    });
    if (!found) return;
    await db.issue.update({
      where: { id: found.id },
      data: {
        status: "resolved",
        resolvedAt: new Date(),
        events: { create: { action: "resolved", data: why } },
      },
    });
  }

  /**
   * A step of the journey an open platform issue belongs to, on its log. The holder takes steps;
   * taking one claims an issue nobody holds. `anyone` lets the step through whoever holds it, as
   * recording a payment is (ADR-0013, 2).
   */
  async step(
    staff: Principal,
    key: string,
    data: IssueEventData,
    options: { anyone: boolean },
    db: Db,
  ): Promise<void> {
    const issue = await db.issue.findFirst({
      where: { ...PLATFORM_WORKSPACE, key, status: "open" },
      select: { id: true, holderId: true },
    });
    if (!issue) throw new ConflictException(apiError("CONFLICT", "This step is done already."));
    const done = { ...event(staff, "step"), data };
    if (options.anyone) {
      await db.issueEvent.create({ data: { issueId: issue.id, ...done } });
      return;
    }
    await this.move(
      issue.id,
      { is: "nobody_or_reader" },
      staff.membershipId,
      issue.holderId === null ? [event(staff, "claimed"), done] : [done],
      staff.membershipId,
      db,
    );
  }

  /**
   * Whether an operator holds an open issue at a venue: their pass to install a router there
   * (ADR-0013, 2). The admin and managers reach every venue; nobody else installs.
   */
  async handedAt(staff: Principal, venueId: string): Promise<boolean> {
    if (staff.scope !== "platform") return false;
    if (staff.role !== "operator") return true;
    const held = await this.db.issue.findFirst({
      where: { ...PLATFORM_WORKSPACE, venueId, status: "open", holderId: staff.membershipId },
      select: { id: true },
    });
    return held !== null;
  }

  /** The reader's workspace: the platform's issues, or their business's within their venues. */
  private inReach(staff: Principal): Prisma.IssueWhereInput {
    if (staff.scope === "platform") {
      // Operators are the technicians who go to venues: they see an issue once it is handed to
      // them, as a pass to go ahead with it.
      return this.keepsSight(staff)
        ? PLATFORM_WORKSPACE
        : { ...PLATFORM_WORKSPACE, holderId: staff.membershipId };
    }
    return {
      scope: "business",
      businessId: staff.businessId ?? "",
      ...(staff.venueIds === null
        ? {}
        : { OR: [{ venueId: null }, { venueId: { in: staff.venueIds } }] }),
    };
  }

  /** Whether the reader sees issues nobody hands them: everyone but a platform operator. */
  private keepsSight(staff: Principal): boolean {
    return !(staff.scope === "platform" && staff.role === "operator");
  }

  private async row(staff: Principal, id: string): Promise<Row> {
    const row = await this.db.issue.findFirst({ where: { id, ...this.inReach(staff) }, include });
    if (!row) throw notFound();
    return row;
  }

  private async openRow(staff: Principal, id: string): Promise<Row> {
    const row = await this.row(staff, id);
    if (row.status !== "open") {
      throw new ConflictException(apiError("CONFLICT", "This issue is resolved."));
    }
    return row;
  }

  /**
   * Moves an open issue to `to` and logs it, only while it is still held as `from` expects: one
   * conditional write, so two people claiming at once never both get it.
   */
  private async move(
    id: string,
    from: Holder,
    to: string | null,
    events: Event[],
    reader: string | null = null,
    db: Db | null = null,
  ): Promise<void> {
    const holder: Prisma.IssueWhereInput =
      from.is === "nobody"
        ? { holderId: null }
        : from.is === "reader"
          ? { holderId: reader }
          : from.is === "nobody_or_reader"
            ? { OR: [{ holderId: null }, { holderId: reader }] }
            : { holderId: from.is };
    const write = async (tx: Db) => {
      const { count } = await tx.issue.updateMany({
        where: { id, status: "open", ...holder },
        data: { holderId: to },
      });
      if (count === 0) throw heldByOther();
      await tx.issueEvent.createMany({
        data: events.map((e) => ({ issueId: id, ...e, data: e.data ?? Prisma.DbNull })),
      });
    };
    if (db) await write(db);
    else await this.db.$transaction(write);
  }

  /** Who in the reader's workspace can work on an issue of this kind at this venue. */
  private async workspacePeople(
    staff: Principal,
    kind: IssueKind,
    venueId: string | null,
  ): Promise<IssuePerson[]> {
    const roles: MembershipRole[] =
      staff.scope === "platform"
        ? PLATFORM_KINDS_FOR_OPERATORS.includes(kind)
          ? ["admin", "manager", "operator"]
          : ["admin", "manager"]
        : ["owner", "business_manager", "venue_manager"];
    const rows = await this.db.membership.findMany({
      where: {
        status: "active",
        scope: staff.scope,
        businessId: staff.scope === "platform" ? null : staff.businessId,
        role: { in: roles },
        // A venue manager works only on their venues' issues.
        ...(staff.scope === "business" && venueId
          ? {
              OR: [
                { role: { in: ["owner", "business_manager"] } },
                { venues: { some: { venueId } } },
              ],
            }
          : {}),
      },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(person);
  }

  /**
   * Held with nothing done for a day; a scheduled setup instead waits for its date, and stalls
   * only once the date has passed and its router hasn't reached HashiNet (ADR-0011, 11).
   */
  private stalled(row: Row, lastActivity: Date): boolean {
    if (row.holderId === null) return false;
    const setupDate = row.venue?.onboarding?.setupDate ?? null;
    if (row.kind === "venue_setup" && setupDate) {
      const reached = (row.venue?.routers ?? []).some(
        (r) => r.lastSeenAt !== null || r.status === "online",
      );
      return !reached && setupDate.toISOString().slice(0, 10) < businessDayOf(new Date());
    }
    return Date.now() - lastActivity.getTime() > DAY_MS;
  }

  private record(staff: Principal, row: Row): IssueRecord {
    const lastActivity = row.events[0]?.at ?? row.openedAt;
    const open = row.status === "open";
    const mine = row.holderId === staff.membershipId;
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      // A platform issue names the business through its venue.
      business: row.business ?? row.venue?.business ?? null,
      venue: row.venue ? { id: row.venue.id, name: row.venue.name } : null,
      router: row.router,
      holder: row.holder ? person(row.holder) : null,
      mine,
      canClaim: open && row.holderId === null,
      canTakeOver: open && row.holder !== null && !mine && outranks(staff.role, row.holder.role),
      canRelease: open && mine,
      canNote: open && (mine || row.holderId === null),
      stalled: open && this.stalled(row, lastActivity),
      openedAt: row.openedAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    };
  }
}

/** What an issue opens with. */
export type IssueOpening = Workspace & {
  kind: IssueKind;
  key: string;
  venueId: string | null;
  routerId: string | null;
  holderId: string | null;
};

/** Opens an issue unless one is open for its key in the workspace; idempotent. */
export async function openIssue(db: Db | PrismaClient, input: IssueOpening): Promise<void> {
  const where = { scope: input.scope, businessId: input.businessId, key: input.key };
  if (await db.issue.findFirst({ where: { ...where, status: "open" }, select: { id: true } })) {
    return;
  }
  try {
    await db.issue.create({
      data: {
        ...where,
        kind: input.kind,
        venueId: input.venueId,
        routerId: input.routerId,
        holderId: input.holderId,
        events: { create: { action: "opened", toId: input.holderId } },
      },
    });
  } catch (err) {
    // Opened at the same moment elsewhere (`issues_open_key`): it is open, which is the point.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
  }
}

function event(staff: Principal, action: IssueAction): Event {
  return { action, actorId: staff.membershipId, toId: null, note: null, data: null };
}

function person(m: { id: string; role: MembershipRole; user: { name: string } }): IssuePerson {
  return { membershipId: m.id, name: m.user.name, role: m.role };
}
