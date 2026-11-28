/**
 * Where our firewall rules sit among the hotspot's own: a rule placed by tag, first in its chain,
 * or ahead of the dynamic rules a running hotspot adds. The firewall steps place their rules here.
 */

import { type RosClient, type RosRow, rowId, tagFor, yes } from "./ros-client.js";

export async function ensureTaggedRule(
  ros: RosClient,
  menu: string,
  stepId: string,
  params: string[],
): Promise<void> {
  const existing = await ros.findByTag(menu, stepId);
  const withTag = [...params, `=comment=${tagFor(stepId)}`];
  if (existing?.get(".id")) {
    await ros.set(menu, rowId(existing), params);
    return;
  }
  await ros.add(menu, withTag);
}

/**
 * Like `ensureTaggedRule`, for a firewall rule that only counts ahead of the hotspot's own rules:
 * set or added first, then moved there.
 */
export async function ensureRuleAheadOfHotspotRules(
  ros: RosClient,
  menu: string,
  stepId: string,
  params: string[],
): Promise<void> {
  const existing = await ros.findByTag(menu, stepId);
  if (existing?.get(".id")) await ros.set(menu, rowId(existing), params);
  else await addRuleFirst(ros, menu, stepId, params);
  await moveRuleAheadOfHotspotRules(ros, menu, stepId);
}

/**
 * Add a firewall rule at the **top** of its list, which is where it has to be to matter: the
 * hotspot's own rules reject unauthenticated traffic, so a permit placed after them never runs.
 *
 * `=place-before=0` is what this used to send, and it aborted a whole Set up on a freshly reset
 * board with `no such item`. Measured on an hAP lite: `place-before` needs an item that exists —
 * an `.id` works and lands the rule at position 0, an index past the end is rejected. On a clean
 * board this step runs moments after the hotspot server is created, before RouterOS has populated
 * its dynamic rules, so there is no rule at index 0 to place before and the add fails. The same
 * command succeeds on a second run, which is exactly how it passed the first clean-board test and
 * still broke the second.
 *
 * So: resolve the current first rule's real `.id`, and when the list is genuinely empty just add.
 * A rule that is first in an empty list is first either way — being unable to name a predecessor
 * is not a reason to fail a critical step.
 */
export async function addRuleFirst(
  ros: RosClient,
  menu: string,
  stepId: string,
  params: string[],
): Promise<void> {
  const tagged = [...params, `=comment=${tagFor(stepId)}`];
  const [first] = await ros.print(menu);

  if (first?.get(".id")) {
    await ros.add(menu, [...tagged, `=place-before=${first.get(".id")}`]);
    return;
  }

  /*
   * Empty list: add, then move to the top on the next pass.
   *
   * Appending is not enough on its own. On a clean board this runs before RouterOS has
   * materialised the hotspot's dynamic rules, so the list is briefly empty — and the dynamic
   * `forward jump` rules it adds a moment later land ABOVE our static accept, leaving it dead last
   * where the hotspot's own reject can pre-empt it. Measured: our rule ended at index 15 of 16.
   *
   * `ruleAheadOfHotspotRules` below is what puts it right: the step's `check` fails while the rule is not
   * first, so the next apply moves it, and phase 5's re-check proves it stuck.
   */
  await ros.add(menu, tagged);
}

/**
 * Will our tagged rule be evaluated ahead of the hotspot's dynamic rules?
 *
 * Position is part of "already correct" for these rules, not just existence: an accept below the
 * hotspot's own reject never runs, and nothing else in the system would notice.
 *
 * Boards differ in how that is achieved:
 *
 * - On an hAP lite a static rule moved above the dynamic ones stayed there (index 15 to 0).
 * - On RouterOS 7.25 (CHR, router sim, 2026-10-29) a running hotspot keeps its dynamic rules first
 *   whatever static rules do. It inserts them directly above its disabled placeholder rule,
 *   "place hotspot rules here", each time it starts: a rule above the placeholder is evaluated
 *   first from the hotspot's next start, and a move above the dynamic rules is ignored.
 *
 * So the rule is ahead when it is above the first dynamic rule, or above the placeholder. Until the
 * hotspot next starts the walled garden still lets clients reach the backend, because its return
 * precedes the reject. Both firewall steps need this, which is why the criterion is a position
 * relative to the hotspot's rules and never "first in the list": two rules demanding index 0 would
 * shove each other on every run and the re-check could never come back clean.
 */
const HOTSPOT_PLACEHOLDER = "place hotspot rules here";

function dynamicIndex(rows: RosRow[]): number {
  const i = rows.findIndex((r) => yes(r.get("dynamic")));
  return i === -1 ? rows.length : i;
}

export async function ruleAheadOfHotspotRules(
  ros: RosClient,
  menu: string,
  stepId: string,
): Promise<boolean> {
  return aheadOfHotspotRules(await ros.print(menu), stepId);
}

export function aheadOfHotspotRules(rows: RosRow[], stepId: string): boolean {
  const mine = rows.findIndex((r) => r.get("comment") === tagFor(stepId));
  if (mine === -1) return false;
  const placeholder = rows.findIndex((r) => r.get("comment") === HOTSPOT_PLACEHOLDER);
  return mine < dynamicIndex(rows) || (placeholder !== -1 && mine < placeholder);
}

/**
 * A freshly started hotspot adds its dynamic rules and placeholder a moment after the server is
 * created, and above any rule placed before them (CHR 7.25, router sim). Placing our rule first
 * left it below the placeholder and failed the read-back. Returns the menu once the hotspot's
 * rules exist, or as it stands when they never appear within `waitMs`.
 */
const HOTSPOT_RULES_WAIT_MS = 10_000;

async function hotspotRulesPresent(
  ros: RosClient,
  menu: string,
  waitMs: number,
): Promise<RosRow[]> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const rows = await ros.print(menu);
    const present = rows.some(
      (r) => yes(r.get("dynamic")) || r.get("comment") === HOTSPOT_PLACEHOLDER,
    );
    if (present || Date.now() >= deadline) return rows;
    await new Promise((done) => setTimeout(done, 250));
  }
}

/** Move our tagged rule above the hotspot's placeholder, or above the dynamic rules without one. */
export async function moveRuleAheadOfHotspotRules(
  ros: RosClient,
  menu: string,
  stepId: string,
  waitMs = HOTSPOT_RULES_WAIT_MS,
): Promise<void> {
  const rows = await hotspotRulesPresent(ros, menu, waitMs);
  if (await ruleAheadOfHotspotRules(ros, menu, stepId)) return;
  const mine = rows.find((r) => r.get("comment") === tagFor(stepId));
  const target =
    rows.find((r) => r.get("comment") === HOTSPOT_PLACEHOLDER) ?? rows[dynamicIndex(rows)];
  if (!mine || !target?.get(".id")) return;
  await ros.exec(`${menu}/move`, [`=numbers=${rowId(mine)}`, `=destination=${rowId(target)}`]);
}
