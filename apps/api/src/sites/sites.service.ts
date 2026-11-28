import type { VenueSiteRecord, VenueSites } from "@hashinet/types";
import {
  ConflictException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from "@nestjs/common";
import { z } from "zod";
import { BillingEvents } from "../billing/billing-events.js";
import { BillingSettings } from "../billing/billing-settings.js";
import { lockBusiness } from "../billing/business-lock.js";
import { Invoices } from "../billing/invoices.js";
import type { Principal } from "../core/access/principal.js";
import { AuditLog } from "../core/audit/audit-log.js";
import { PrismaService } from "../core/database/prisma.service.js";
import { apiError } from "../core/http/error-envelope.js";
import { oneLine } from "../core/http/validation.js";
import { captureFailure } from "../core/observability/telemetry.js";
import { Prisma } from "../generated/prisma/client.js";
import { RouterSync } from "../services/router-sync.js";
import { VenuesService } from "../venues/venues.service.js";
import { openHosts, openSites, slotPaid } from "./open-sites.js";

const HOST_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** A pasted address reduced to its host name, as a router's walled garden takes it. */
export const siteInput = z.object({
  host: z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => value.replace(/^https?:\/\//, "").replace(/[/?#:].*$/, ""))
    .refine((value) => HOST_NAME.test(value), "must be a site's address, such as hotel.co.tz"),
  /** Why it is open, for the business's people. */
  note: oneLine(120)
    .default("")
    .transform((v) => v || null),
});

const notFound = () => new NotFoundException(apiError("NOT_FOUND", "There is no such site."));

/**
 * A venue's sites open before paying (slice 5): the first comes with the venue; each more takes a
 * slot, invoiced once when it is added (due 7 days later, on the owner's bill issue) and open once
 * HashiNet records the payment. Removing a site gives back a slot nobody has paid towards; a paid
 * slot stays with the venue. Only open sites reach its routers, at once on every change.
 */
@Injectable()
export class SitesService implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    private readonly venues: VenuesService,
    private readonly invoices: Invoices,
    private readonly settings: BillingSettings,
    private readonly events: BillingEvents,
    private readonly sync: RouterSync,
  ) {}

  /** A payment can pay for a slot: the business's venues with sites bring their routers in line. */
  onModuleInit(): void {
    this.events.onPaid(async (businessId) => {
      const venues = await this.db.venue.findMany({
        where: { businessId, siteSlots: { some: {} } },
        select: { id: true },
      });
      await Promise.all(venues.map((v) => this.push(v.id)));
    });
  }

  async list(staff: Principal, venueId: string): Promise<VenueSites> {
    await this.venues.get(staff, venueId);
    const [{ sites, slots, openCount }, { siteSlotTsh }] = await Promise.all([
      openSites(this.db, venueId),
      this.settings.get(),
    ]);
    const paid = slots.filter(slotPaid);
    const unpaid = slots.filter((s) => !slotPaid(s));
    const records: VenueSiteRecord[] = sites.map((site, i) => {
      const open = i < openCount;
      // The first is the venue's own; the next take the paid slots, then the ones still owed.
      const slot = i === 0 ? null : open ? (paid[i - 1] ?? null) : (unpaid[i - openCount] ?? null);
      return {
        id: site.id,
        host: site.host,
        note: site.note,
        state: open ? "open" : "waiting",
        cost: i === 0 || slot?.invoice === null ? "included" : open ? "paid" : "due",
        slotTsh: slot?.invoice ? slot.invoice.totalTsh : null,
        invoice:
          !open && slot?.invoiceId && slot.invoice
            ? { id: slot.invoiceId, number: slot.invoice.number }
            : null,
        addedAt: site.createdAt.toISOString(),
        addedBy: site.addedBy?.user.name ?? null,
      };
    });
    // One more site comes free while the venue has none, or a slot no site uses.
    const free = sites.length === 0 || sites.length < 1 + slots.length;
    return { sites: records, nextCostTsh: free ? 0 : siteSlotTsh };
  }

  async add(
    staff: Principal,
    venueId: string,
    input: z.infer<typeof siteInput>,
    now = new Date(),
  ): Promise<VenueSites> {
    const venue = await this.venues.get(staff, venueId);
    const invoice = await this.db.$transaction(async (tx) => {
      // One change at a time to a business's charges, as a payment holds it.
      await lockBusiness(tx, venue.businessId);
      try {
        await tx.venueSite.create({
          data: { venueId, host: input.host, note: input.note, addedById: staff.membershipId },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new ConflictException(
            apiError("CONFLICT", `${input.host} is already on ${venue.name}'s list.`),
          );
        }
        throw err;
      }
      const [count, slots] = await Promise.all([
        tx.venueSite.count({ where: { venueId } }),
        tx.siteSlot.count({ where: { venueId } }),
      ]);
      let issued = null;
      // Beyond the one that comes with the venue and the slots it has, a new slot is invoiced.
      if (count > 1 + slots) {
        const { siteSlotTsh } = await this.settings.get();
        issued = await this.invoices.issueSlot(
          tx,
          { businessId: venue.businessId, venueId, host: input.host, priceTsh: siteSlotTsh },
          now,
        );
        if (issued) await tx.siteSlot.create({ data: { venueId, invoiceId: issued.id } });
      }
      await this.audit.record(
        staff,
        {
          action: "venue.site.add",
          businessId: venue.businessId,
          venueId,
          target: { type: "venue", id: venueId },
          change: { before: {}, after: { host: input.host, invoiced: issued !== null } },
        },
        tx,
      );
      return issued;
    });
    if (invoice) await this.invoices.chargeChanged(venue.businessId, invoice);
    await this.push(venueId);
    return this.list(staff, venueId);
  }

  async remove(staff: Principal, venueId: string, siteId: string): Promise<VenueSites> {
    const venue = await this.venues.get(staff, venueId);
    const cancelled = await this.db.$transaction(async (tx) => {
      await lockBusiness(tx, venue.businessId);
      const site = await tx.venueSite.findFirst({ where: { id: siteId, venueId } });
      if (!site) throw notFound();
      await tx.venueSite.delete({ where: { id: siteId } });
      const count = await tx.venueSite.count({ where: { venueId } });
      // Slots beyond the sites left go back, newest first, only if nothing was paid towards them;
      // each one's invoice is cancelled, kept with its number.
      const slots = await tx.siteSlot.findMany({
        where: { venueId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          invoiceId: true,
          invoice: { select: { allocations: { select: { id: true } } } },
        },
      });
      let spare = slots.length - Math.max(0, count - 1);
      const withdrawn = [];
      for (const slot of slots) {
        if (spare <= 0) break;
        if (!slot.invoiceId || (slot.invoice?.allocations.length ?? 0) > 0) continue;
        await tx.siteSlot.delete({ where: { id: slot.id } });
        withdrawn.push(
          await this.invoices.cancel(
            tx,
            slot.invoiceId,
            `The site it was for, ${site.host}, was removed before anything was paid.`,
          ),
        );
        spare -= 1;
      }
      await this.audit.record(
        staff,
        {
          action: "venue.site.remove",
          businessId: venue.businessId,
          venueId,
          target: { type: "venue", id: venueId },
          change: {
            before: { host: site.host },
            after: { invoicesCancelled: withdrawn.map((i) => i.number).join(", ") || null },
          },
        },
        tx,
      );
      return withdrawn;
    });
    if (cancelled.length > 0) await this.invoices.chargeChanged(venue.businessId, ...cancelled);
    await this.push(venueId);
    return this.list(staff, venueId);
  }

  /**
   * The venue's routers get its open sites now; one that can't be reached gets them at Set up. A
   * venue's pushes run one after another, each reading the list when it runs, so the last change's
   * list is the one that stays.
   */
  private push(venueId: string): Promise<void> {
    const run = (this.pushing.get(venueId) ?? Promise.resolve())
      .then(async () => this.sync.pushOpenSites(venueId, await openHosts(this.db, venueId)))
      .catch(captureFailure);
    this.pushing.set(venueId, run);
    void run.finally(() => {
      if (this.pushing.get(venueId) === run) this.pushing.delete(venueId);
    });
    return Promise.resolve();
  }

  private readonly pushing = new Map<string, Promise<void>>();
}
