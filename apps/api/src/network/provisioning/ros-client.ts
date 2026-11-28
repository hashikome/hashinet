/**
 * Thin, logged wrapper around the RouterOS API.
 *
 * Every call goes through `RouterLogger`, so a provisioning run produces a complete,
 * visible transcript of what was sent and what came back. Steps use this instead of
 * touching `conn.write()` directly.
 */

import type { MikroTikConn } from "../mikrotik/mikrotik.js";
import type { RouterLogger } from "../mikrotik/router-log.js";

/** One row from the RouterOS API. A field the router did not send is null. */
export class RosRow {
  constructor(private readonly fields: Readonly<Record<string, unknown>>) {}

  get(field: string): string | null {
    const value = this.fields[field];
    return typeof value === "string" ? value : null;
  }
}

/** A row's RouterOS `.id`. Every row the router returns carries one; a row without it is a protocol fault. */
export function rowId(row: RosRow): string {
  const id = row.get(".id");
  if (!id) throw new Error("RouterOS returned a row without an .id");
  return id;
}

/** The API's reply as rows. Anything that is not an object carries no fields. */
export function toRows(result: unknown): RosRow[] {
  if (!Array.isArray(result)) return [];
  return result.map((row: unknown) =>
    typeof row === "object" && row !== null
      ? new RosRow(row as Record<string, unknown>)
      : new RosRow({}),
  );
}

/** Objects this system owns are tagged so we never touch hand-made rules. */
export const WBS_TAG = "wbs";

export function tagFor(stepId: string): string {
  return `${WBS_TAG}:${stepId}`;
}

export class RosClient {
  constructor(
    private readonly conn: MikroTikConn,
    readonly logger: RouterLogger,
    readonly host: string,
  ) {}

  /** `menu` is a RouterOS path without the trailing action, e.g. "/ip/firewall/filter" */
  async print(menu: string, filters: string[] = []): Promise<RosRow[]> {
    const command = `${menu}/print`;
    const result = await this.logger.run({ host: this.host, command, params: filters }, () =>
      this.conn.write(command, filters),
    );
    return toRows(result);
  }

  /** Returns null when the menu doesn't exist on this firmware, instead of throwing. */
  async tryPrint(menu: string, filters: string[] = []): Promise<RosRow[] | null> {
    const command = `${menu}/print`;
    const result = await this.logger.probe({ host: this.host, command, params: filters }, () =>
      this.conn.write(command, filters),
    );
    return result === null ? null : toRows(result);
  }

  async add(menu: string, params: string[]): Promise<string | null> {
    const command = `${menu}/add`;
    const result = await this.logger.run({ host: this.host, command, params }, () =>
      this.conn.write(command, params),
    );
    const rows = toRows(result);
    return rows[0]?.get("ret") ?? rows[0]?.get(".id") ?? null;
  }

  async set(menu: string, id: string, params: string[]): Promise<void> {
    const command = `${menu}/set`;
    const withId = [`=.id=${id}`, ...params];
    await this.logger.run({ host: this.host, command, params: withId }, () =>
      this.conn.write(command, withId),
    );
  }

  /** For singleton menus with no `.id`, e.g. /ip/dns, /system/identity */
  async setSingleton(menu: string, params: string[]): Promise<void> {
    const command = `${menu}/set`;
    await this.logger.run({ host: this.host, command, params }, () =>
      this.conn.write(command, params),
    );
  }

  async remove(menu: string, id: string): Promise<void> {
    const command = `${menu}/remove`;
    const params = [`=.id=${id}`];
    await this.logger.run({ host: this.host, command, params }, () =>
      this.conn.write(command, params),
    );
  }

  /** Like `exec`, but null when the command doesn't exist on this firmware. */
  async tryExec(command: string, params: string[] = []): Promise<RosRow[] | null> {
    const result = await this.logger.probe({ host: this.host, command, params }, () =>
      this.conn.write(command, params),
    );
    return result === null ? null : toRows(result);
  }

  /** Raw escape hatch for commands that aren't add/set/print (e.g. /tool/fetch). */
  async exec(command: string, params: string[] = []): Promise<RosRow[]> {
    const result = await this.logger.run({ host: this.host, command, params }, () =>
      this.conn.write(command, params),
    );
    return toRows(result);
  }

  /** First object in `menu` carrying our step tag, or null. */
  async findByTag(menu: string, stepId: string): Promise<RosRow | null> {
    const rows = await this.print(menu, [`?comment=${tagFor(stepId)}`]);
    return rows[0] ?? null;
  }

  async findByName(menu: string, name: string): Promise<RosRow | null> {
    const rows = await this.print(menu, [`?name=${name}`]);
    return rows[0] ?? null;
  }
}

/**
 * `/ping` streams one `!re` per reply and carries running totals on each. Read the totals off
 * the last row where possible, and fall back to counting rows that came back with a time.
 */
export function pingTotals(rows: RosRow[]): { sent: number; received: number } {
  const last = rows[rows.length - 1] ?? null;
  const total = (field: string): number | null => {
    const raw = last?.get(field) ?? null;
    if (raw === null) return null;
    const count = Number(raw);
    return Number.isFinite(count) ? count : null;
  };
  const sent = total("sent");
  return {
    sent: sent !== null && sent > 0 ? sent : rows.length,
    received: total("received") ?? rows.filter((r) => r.get("time") !== null).length,
  };
}

/** A RouterOS yes/no property, as `true`/`yes`. */
export const yes = (v: string | null) => v === "true" || v === "yes";
