/**
 * Regional scope rules for the digest.
 *
 * The digest covers Luzerne County plus every county within roughly 50 miles
 * of its border. Counties are grouped into three tiers so that home-county
 * coverage still leads the email even when the wider region is busy:
 *
 *   Tier 1 — Luzerne itself.
 *   Tier 2 — adjacent / <=45 mi. A realistic drive for an evening event.
 *   Tier 3 — outer edge, ~50-60 mi. Big event generators (Allentown,
 *            Bethlehem, Stroudsburg) that need a stronger reason to make
 *            the cut.
 *
 * Everything here is pure so it can be unit tested without network or DB.
 */

export type Tier = 1 | 2 | 3;

export const DEFAULT_TIER: Tier = 2;

/** How far ahead of the run date an event may start and still be included. */
export const EVENT_WINDOW_DAYS = 14;

/** Score adjustment applied after Claude has scored an article 0-10. */
export const TIER_BONUS: Record<Tier, number> = {
  1: 1.5,
  2: 0,
  3: -1.0,
};

export const COUNTY_TIERS: Record<string, Tier> = {
  luzerne: 1,

  lackawanna: 2,
  wyoming: 2,
  columbia: 2,
  carbon: 2,
  monroe: 2,
  schuylkill: 2,
  sullivan: 2,
  susquehanna: 2,
  wayne: 2,
  montour: 2,

  pike: 3,
  northampton: 3,
  lehigh: 3,
  northumberland: 3,
  bradford: 3,
};

export function tierFor(county: string | undefined | null): Tier {
  if (!county) return DEFAULT_TIER;
  return COUNTY_TIERS[county.trim().toLowerCase()] ?? DEFAULT_TIER;
}

function isTier(value: number): value is Tier {
  return value === 1 || value === 2 || value === 3;
}

/**
 * Nudge a Claude relevance score by the article's tier, then clamp to 0-10.
 * Deterministic and free — no extra API call.
 */
export function applyTierBonus(score: number, tier: number): number {
  const bonus = isTier(tier) ? TIER_BONUS[tier] : TIER_BONUS[DEFAULT_TIER];
  return Math.min(10, Math.max(0, score + bonus));
}

/**
 * Events are future-dated, so they need their own window: anything from the
 * start of the run day through EVENT_WINDOW_DAYS ahead. An event that started
 * earlier today still counts — a 7 AM run should not hide tonight's concert.
 */
export function isEventInWindow(
  start: Date,
  now: Date = new Date(),
  daysAhead: number = EVENT_WINDOW_DAYS
): boolean {
  const startMs = start.getTime();
  if (Number.isNaN(startMs)) return false;

  const floor = new Date(now);
  floor.setHours(0, 0, 0, 0);

  const ceiling = now.getTime() + daysAhead * 24 * 60 * 60 * 1000;

  return startMs >= floor.getTime() && startMs <= ceiling;
}

/** Sort comparator for events: soonest first (news sorts newest first). */
export function compareByStartDate(
  a: { pubDate: Date },
  b: { pubDate: Date }
): number {
  return a.pubDate.getTime() - b.pubDate.getTime();
}

/**
 * Label shown next to an article so readers can tell how far away it is.
 * Luzerne is the assumed default and stays unlabeled to avoid noise.
 */
export function countyLabel(county: string | undefined | null): string {
  if (!county) return '';
  const name = county.trim();
  if (!name || name.toLowerCase() === 'luzerne') return '';
  return `${name} County`;
}
