import type {
  IssueAction,
  IssueDetail,
  IssueEventData,
  IssueList,
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
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { IssueKind } from "../generated/prisma/enums.js";
import { apiError } from "../http/error-envelope.js";
import { conditionOf, routerJourney, type StoredSetup } from "../routers/router-journey.js";

const DAY_MS = 86_400_000;

/** The kinds an issue can be handed to a platform operator in: a venue's package is for the
 * admin and managers only (ADR-0013, 2). */
const PLATFORM_KINDS_FOR_OPERATORS: IssueKind[] = ["router_offline", "venue_setup"];

type Db = Prisma.TransactionClient;

const line = z
  .string()
  .trim()
  .max(500)
  .regex(/^[^\p{Cc}]*$/u, "must be one line of text");
export const handInput = z.object({ to: z.uuid(), note: line.nullable().default(null) });
export const takeOverInput = z.object({ reason: line.min(1, "is required") });
export const noteInput = z.object({ note: line.min(1, "is required") });
export const listQuery = z.object({
  status: z.enum(["open", "resolved", "all"]).default("open"),
});

const notFound = () => new NotFoundException(apiError("NOT_FOUND", "No such issue."));
const heldByOther = () =>
  new ForbiddenException(
    apiError("FORBIDDEN", "Someone else is responsible for this issue. Take it over to act."),
  );

const include = {
  business: { select: { id: true, name: true } },
  venue: { select: { id: true, name: true, business: { select: { id: true, name: true } } } },
  router: { select: { id: true, name: true } },
  holder: { include: { user: { select: { name: true } } } },
  events: { orderBy: { at: "desc" }, take: 1, select: { at: true } },
} as const satisfies Prisma.IssueInclude;

type Row = Prisma.IssueGetPayload<{ include: typeof include }>;

/**
 * Issues (redesign-admin, Issues; ADR-0011, 11): everything that needs someone, kept per workspace.
 * Someone claims an issue (or acting first does), releases it or hands it on; only someone above
 * the holder takes it over, with a reason. Every step is on its log. Router issues come and go with
 * the router's state; the others are opened and resolved by the journeys they belong to.
 */
@Injectable()
export class IssuesService {
  constructor(private readonly db: PrismaService) {}

  async list(staff: Principal, status: "open" | "resolved" | "all"): Promise<IssueList> {
    const where = this.inReach(staff);
    const [rows, openCount] = await Promise.all([
      this.db.issue.findMany({
        where: { ...where, ...(status === "all" ? {} : { status }) },
        include,
        orderBy: [{ status: "asc" }, { openedAt: "desc" }],
        take: 200,
      }),
      this.db.issue.count({ where: { ...where, status: "open" } }),
    ]);
    return { issues: rows.map((row) => this.record(staff, row)), openCount };
  }

  async detail(staff: Principal, id: string): Promise<IssueDetail> {
    const row = await this.row(staff, id);
    const [events, people, owner] = await Promise.all([
      this.db.issueEvent.findMany({
        where: { issueId: id },
        include: {
          actor: { include: { user: { select: { name: true } } } },
          to: { include: { user: { select: { name: true } } } },
        },
        orderBy: [{ at: "asc" }, { id: "asc" }],
      }),
      this.workspacePeople(staff, row.kind, row.venueId),
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
      handTo:
        row.status === "open" ? people.filter((p) => p.membershipId !== staff.membershipId) : [],
      contact: owner ? owner.user : null,
    };
  }

  async claim(staff: Principal, id: string): Promise<IssueDetail> {
    const row = await this.openRow(staff, id);
    if (row.holderId === staff.membershipId) return this.detail(staff, id);
    if (row.holderId !== null) throw heldByOther();
    await this.act(staff, id, { holderId: staff.membershipId }, "claimed");
    return this.detail(staff, id);
  }

  /** Gives the issue back; it may leave the reader's sight (an operator's), so it answers nothing. */
  async release(staff: Principal, id: string): Promise<void> {
    const row = await this.openRow(staff, id);
    if (row.holderId !== staff.membershipId) throw heldByOther();
    await this.act(staff, id, { holderId: null }, "released");
  }

  /** The holder, or anyone while nobody holds it, hands it to someone else in the workspace. */
  async hand(staff: Principal, id: string, input: z.infer<typeof handInput>): Promise<void> {
    const row = await this.openRow(staff, id);
    if (row.holderId !== null && row.holderId !== staff.membershipId) throw heldByOther();
    const people = await this.workspacePeople(staff, row.kind, row.venueId);
    if (input.to === staff.membershipId || !people.some((p) => p.membershipId === input.to)) {
      throw new BadRequestException(
        apiError("VALIDATION_FAILED", "Check the highlighted fields.", {
          to: "must be someone else who can work on it",
        }),
      );
    }
    await this.act(staff, id, { holderId: input.to }, "handed", input.note, input.to);
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
    await this.act(staff, id, { holderId: staff.membershipId }, "taken_over", input.reason);
    return this.detail(staff, id);
  }

  /** A note on its log. Acting first claims an issue nobody holds. */
  async note(staff: Principal, id: string, input: z.infer<typeof noteInput>): Promise<IssueDetail> {
    const row = await this.openRow(staff, id);
    if (row.holderId !== null && row.holderId !== staff.membershipId) throw heldByOther();
    if (row.holderId === null)
      await this.act(staff, id, { holderId: staff.membershipId }, "claimed");
    await this.act(staff, id, {}, "noted", input.note);
    return this.detail(staff, id);
  }

  /**
   * Keeps router issues in step with the routers: a router that has served and stopped answering
   * opens one in the platform's workspace and in its business's; serving again resolves both. A
   * router still being set up raises none.
   */
  async syncRouterIssues(): Promise<void> {
    const routers = await this.db.router.findMany({
      select: {
        id: true,
        status: true,
        setupStartedAt: true,
        setupPhase: true,
        lastSetupAt: true,
        lastSetup: true,
        venueId: true,
        venue: { select: { businessId: true } },
      },
    });
    for (const r of routers) {
      const condition = conditionOf(
        routerJourney(r, r.lastSetup as StoredSetup | null).stage,
        r.status,
      );
      const key = `router:${r.id}`;
      const down = condition === "offline" || condition === "needs-attention";
      for (const workspace of [
        { scope: "platform" as const, businessId: null },
        { scope: "business" as const, businessId: r.venue.businessId },
      ]) {
        if (down) {
          await this.open({
            ...workspace,
            kind: "router_offline",
            key,
            venueId: r.venueId,
            routerId: r.id,
          });
        } else {
          await this.resolve(workspace, key, { reason: "serving" });
        }
      }
    }
  }

  /** Opens an issue unless one is open for its key in the workspace; idempotent. */
  async open(
    input: {
      scope: "platform" | "business";
      businessId: string | null;
      kind: IssueKind;
      key: string;
      venueId?: string | null;
      routerId?: string | null;
      data?: Record<string, string | number | boolean | null>;
      holderId?: string | null;
    },
    db: Db = this.db,
  ): Promise<string> {
    const found = await db.issue.findFirst({
      where: { scope: input.scope, businessId: input.businessId, key: input.key, status: "open" },
      select: { id: true },
    });
    if (found) return found.id;
    const created = await db.issue.create({
      data: {
        scope: input.scope,
        businessId: input.businessId,
        kind: input.kind,
        key: input.key,
        venueId: input.venueId ?? null,
        routerId: input.routerId ?? null,
        data: input.data ?? {},
        holderId: input.holderId ?? null,
        events: { create: { action: "opened", toId: input.holderId ?? null } },
      },
    });
    return created.id;
  }

  /** Resolves the open issue for a key in a workspace, if there is one, with why it ended. */
  async resolve(
    workspace: { scope: "platform" | "business"; businessId: string | null },
    key: string,
    why: IssueEventData,
    db: Db = this.db,
  ): Promise<void> {
    const found = await db.issue.findFirst({
      where: { ...workspace, key, status: "open" },
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

  /** The reader's workspace: the platform's issues, or their business's within their venues. */
  private inReach(staff: Principal): Prisma.IssueWhereInput {
    if (staff.scope === "platform") {
      // Operators are the technicians who go to venues: they see an issue once it is handed to
      // them, as a pass to go ahead with it.
      return staff.role === "operator"
        ? { scope: "platform", holderId: staff.membershipId }
        : { scope: "platform" };
    }
    return {
      scope: "business",
      businessId: staff.businessId ?? "",
      ...(staff.venueIds === null
        ? {}
        : { OR: [{ venueId: null }, { venueId: { in: staff.venueIds } }] }),
    };
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
   * A step of the journey an open platform issue belongs to, on its log. The holder takes steps;
   * taking one claims an issue nobody holds. `anyone` lets the step through whoever holds it, as
   * recording a payment is (ADR-0013, 2). Returns the issue's id.
   */
  async step(
    staff: Principal,
    key: string,
    data: IssueEventData,
    options: { anyone: boolean },
    db: Db,
  ): Promise<string> {
    const issue = await db.issue.findFirst({
      where: { scope: "platform", businessId: null, key, status: "open" },
      select: { id: true, holderId: true },
    });
    if (!issue) throw new ConflictException(apiError("CONFLICT", "This step is done already."));
    if (!options.anyone && issue.holderId !== null && issue.holderId !== staff.membershipId) {
      throw heldByOther();
    }
    const claim = !options.anyone && issue.holderId === null;
    await db.issue.update({
      where: { id: issue.id },
      data: {
        ...(claim ? { holderId: staff.membershipId } : {}),
        events: {
          create: [
            ...(claim ? [{ action: "claimed" as const, actorId: staff.membershipId }] : []),
            { action: "step" as const, actorId: staff.membershipId, data },
          ],
        },
      },
    });
    return issue.id;
  }

  private async act(
    staff: Principal,
    id: string,
    change: { holderId?: string | null },
    action: IssueAction,
    note: string | null = null,
    toId: string | null = null,
  ): Promise<void> {
    await this.db.issue.update({
      where: { id },
      data: { ...change, events: { create: { action, actorId: staff.membershipId, note, toId } } },
    });
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

  private record(staff: Principal, row: Row): IssueRecord {
    const lastActivity = row.events[0]?.at ?? row.openedAt;
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      // A platform issue names the business through its venue.
      business: row.business ?? row.venue?.business ?? null,
      venue: row.venue ? { id: row.venue.id, name: row.venue.name } : null,
      router: row.router,
      holder: row.holder ? person(row.holder) : null,
      mine: row.holderId === staff.membershipId,
      canClaim: row.status === "open" && row.holderId === null,
      canTakeOver:
        row.status === "open" &&
        row.holder !== null &&
        row.holderId !== staff.membershipId &&
        outranks(staff.role, row.holder.role),
      stalled:
        row.status === "open" &&
        row.holderId !== null &&
        Date.now() - lastActivity.getTime() > DAY_MS,
      data: (row.data ?? {}) as IssueRecord["data"],
      openedAt: row.openedAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      lastActivityAt: lastActivity.toISOString(),
    };
  }
}

function person(m: { id: string; role: MembershipRole; user: { name: string } }): IssuePerson {
  return { membershipId: m.id, name: m.user.name, role: m.role };
}
