import groceryConfig from '../grocery.json';

// ---------------------------------------------------------------------------
// Grocery deals — TEST EMAIL ONLY (see sendDigest.ts).
//
// Data source: Flipp / Wishabi's public weekly-circular search endpoint, the
// same feed the Flipp app uses. There is NO official documented API and NO
// per-store distance in the item payload, so "within 30 miles" is approximated
// two ways, both configurable in grocery.json:
//   1. postal_code localizes results to the ZIP's flyer service area, and
//   2. a NEPA grocery-store allowlist ("stores") filters out pet stores,
//      restaurant-supply, and far-off chains.
// If the endpoint ever changes shape, this whole section is caught and skipped
// in sendDigest.ts, exactly like weather/calendar — it never blocks the digest.
// ---------------------------------------------------------------------------

const FLIPP_BASE = 'https://backflipp.wishabi.com/flipp/items/search';

interface GroceryConfig {
  zip: string;
  radiusMiles: number;
  maxPerItem: number;
  items: Array<{ label: string; query: string }>;
  stores: string[];
}

// A single sale item pulled from a store's weekly circular.
export interface GroceryDeal {
  name: string;         // e.g. "Boneless Skinless Chicken Breast"
  merchant: string;     // e.g. "Weis Markets"
  priceText: string;    // formatted, e.g. "$1.99 /lb" or "Starting at $6.75"
  price: number | null; // numeric current price for sorting (null if none)
  validTo: Date | null; // when the deal expires
}

// One searched item (e.g. "Ground Beef") with the matching deals.
export interface GroceryGroup {
  label: string;
  deals: GroceryDeal[];
}

// Raw Flipp item shape (only the fields we use).
interface FlippItem {
  name: string;
  merchant_name: string | null;
  current_price: number | null;
  pre_price_text: string | null;   // e.g. "Starting at"
  post_price_text: string | null;  // e.g. "/lb", "ea"
  sale_story: string | null;       // e.g. "2 for $5"
  valid_from: string | null;
  valid_to: string | null;
}

function loadConfig(): GroceryConfig {
  return groceryConfig as GroceryConfig;
}

function formatPrice(item: FlippItem): string {
  if (item.current_price != null) {
    const pre = item.pre_price_text ? `${item.pre_price_text} ` : '';
    const post = item.post_price_text ? ` ${item.post_price_text}` : '';
    return `${pre}$${item.current_price.toFixed(2)}${post}`.trim();
  }
  if (item.sale_story) return item.sale_story;
  if (item.pre_price_text) return item.pre_price_text;
  return 'See flyer';
}

// Keep only deals from an allowlisted store (case-insensitive substring match).
// Empty allowlist = keep everything the ZIP feed returned.
function matchesStore(merchant: string | null, stores: string[]): boolean {
  if (!merchant) return false;
  if (stores.length === 0) return true;
  const m = merchant.toLowerCase();
  return stores.some(s => m.includes(s.toLowerCase()));
}

// Only surface deals that are valid on `now` (drop stale/expired circulars).
function isCurrentlyValid(item: FlippItem, now: number): boolean {
  const from = item.valid_from ? Date.parse(item.valid_from) : NaN;
  const to = item.valid_to ? Date.parse(item.valid_to) : NaN;
  if (!Number.isNaN(from) && now < from) return false;
  if (!Number.isNaN(to) && now > to) return false;
  return true;
}

async function searchItem(
  query: string,
  zip: string,
  cfg: GroceryConfig,
  now: number
): Promise<GroceryDeal[]> {
  const url =
    `${FLIPP_BASE}?locale=en-us` +
    `&postal_code=${encodeURIComponent(zip)}` +
    `&q=${encodeURIComponent(query)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Flipp API error: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as { items?: FlippItem[] };
  const items = data.items ?? [];

  const deals = items
    .filter(it => matchesStore(it.merchant_name, cfg.stores))
    .filter(it => isCurrentlyValid(it, now))
    .map<GroceryDeal>(it => ({
      name: it.name,
      merchant: it.merchant_name ?? 'Unknown',
      priceText: formatPrice(it),
      price: it.current_price,
      validTo: it.valid_to ? new Date(it.valid_to) : null,
    }));

  // Cheapest first; items without a numeric price sort to the bottom.
  deals.sort((a, b) => {
    if (a.price == null && b.price == null) return 0;
    if (a.price == null) return 1;
    if (b.price == null) return -1;
    return a.price - b.price;
  });

  return deals.slice(0, cfg.maxPerItem);
}

export async function fetchGroceryDeals(): Promise<GroceryGroup[]> {
  const cfg = loadConfig();
  const now = Date.now();

  const groups = await Promise.all(
    cfg.items.map(async ({ label, query }) => {
      try {
        const deals = await searchItem(query, cfg.zip, cfg, now);
        return { label, deals };
      } catch {
        // One bad item search never sinks the rest.
        return { label, deals: [] as GroceryDeal[] };
      }
    })
  );

  // Only return groups that actually have deals.
  return groups.filter(g => g.deals.length > 0);
}
