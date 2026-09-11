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

/**
 * Collapse repeat occurrences of a recurring event down to the soonest one.
 *
 * Calendar feeds publish a recurring event as one item PER OCCURRENCE, each
 * with its own URL — Waverly Community House emits
 * `/event/fall-farmers-market/2026-09-11/` and `/2026-09-18/` as separate
 * items. The urlHash dedupe in fetchFeeds can't see these are the same thing,
 * so a weekly event quietly eats two of the six event slots and a daily one
 * could eat the whole section.
 *
 * Keyed on source + title rather than the URL, since the date lives in a
 * different part of the path on every platform. Same title from two different
 * sources stays separate — those really are two events. Undated items are
 * never collapsed: two outlets legitimately run the same headline.
 */
export function collapseRecurringEvents<
  T extends { title: string; source: string; eventDate?: Date }
>(articles: T[]): T[] {
  const soonest = new Map<string, T>();
  // Placeholders hold each event's position so output order matches input,
  // even though a later occurrence can replace an earlier-seen one.
  const slots: (T | { key: string })[] = [];

  for (const a of articles) {
    if (!a.eventDate) {
      slots.push(a);
      continue;
    }

    const key = `${a.source}::${a.title.trim().toLowerCase().replace(/\s+/g, ' ')}`;
    const existing = soonest.get(key);

    if (!existing) {
      soonest.set(key, a);
      slots.push({ key });
    } else if (a.eventDate.getTime() < existing.eventDate!.getTime()) {
      soonest.set(key, a);
    }
  }

  return slots.map(slot => ('key' in slot ? soonest.get(slot.key)! : slot));
}
