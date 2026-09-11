import 'dotenv/config';
import RSSParser from 'rss-parser';
import { withTimeout } from './net';
import sources from '../sources.json';

/**
 * Probe every source in sources.json — active or not — and report what it
 * actually returns. Run this after adding feeds, and before flipping a
 * candidate event calendar to "active": true.
 *
 *   npm run sources:probe
 */

const parser = new RSSParser({ timeout: 15000 });

const PROBE_TIMEOUT_MS = 20_000;

interface ProbeResult {
  name: string;
  tier: number;
  county: string;
  category: string;
  active: boolean;
  items: number;
  newestAge: string;
  status: 'ok' | 'empty' | 'fail';
  detail: string;
}

function ageLabel(dates: Date[]): string {
  const valid = dates.filter(d => !Number.isNaN(d.getTime()));
  if (valid.length === 0) return '—';
  const newest = Math.max(...valid.map(d => d.getTime()));
  const days = (Date.now() - newest) / (24 * 60 * 60 * 1000);
  if (days < 0) return `${Math.abs(days).toFixed(0)}d ahead`;
  return `${days.toFixed(0)}d ago`;
}

async function probe(s: (typeof sources)[number]): Promise<ProbeResult> {
  const base = {
    name: s.name,
    tier: (s as any).tier ?? 2,
    county: (s as any).county ?? '—',
    category: s.category,
    active: !!s.active,
  };

  if (!s.url) {
    return { ...base, items: 0, newestAge: '—', status: 'fail', detail: 'no url' };
  }

  try {
    const feed = await withTimeout(parser.parseURL(s.url), PROBE_TIMEOUT_MS, s.name);
    const items = feed.items ?? [];
    const dates = items
      .map(i => new Date(i.isoDate ?? i.pubDate ?? ''))
      .filter(d => !Number.isNaN(d.getTime()));

    return {
      ...base,
      items: items.length,
      newestAge: ageLabel(dates),
      status: items.length > 0 ? 'ok' : 'empty',
      detail: items.length > 0 ? (items[0].title ?? '').slice(0, 60) : 'feed parsed but no items',
    };
  } catch (err) {
    return {
      ...base,
      items: 0,
      newestAge: '—',
      status: 'fail',
      detail: (err as Error).message.slice(0, 70),
    };
  }
}

async function main(): Promise<void> {
  console.log(`Probing ${sources.length} source(s)...\n`);

  const results = await Promise.all(sources.map(probe));

  const icon = { ok: 'OK  ', empty: 'EMPTY', fail: 'FAIL' } as const;
  const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);

  for (const r of results.sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name))) {
    const flag = r.active ? ' ' : '·';
    console.log(
      `${pad(icon[r.status], 6)}${flag} T${r.tier} ${pad(r.name, 38)} ` +
        `${String(r.items).padStart(3)} items  ${pad(r.newestAge, 10)} ${r.detail}`
    );
  }

  const ok = results.filter(r => r.status === 'ok');
  const inactiveButWorking = ok.filter(r => !r.active);

  console.log(`\n${ok.length}/${results.length} source(s) returned items.`);
  console.log(`(· marks a source that is currently inactive in sources.json)`);

  if (inactiveButWorking.length > 0) {
    console.log(`\nInactive but working — consider activating:`);
    for (const r of inactiveButWorking) console.log(`  - ${r.name} (${r.items} items)`);
  }

  const broken = results.filter(r => r.status !== 'ok' && r.active);
  if (broken.length > 0) {
    console.log(`\nActive but returning nothing — fix or deactivate:`);
    for (const r of broken) console.log(`  - ${r.name}: ${r.detail}`);
  }
}

if (require.main === module) {
  main()
    // Sources abandoned by withTimeout leave their sockets open, which keeps
    // the event loop alive forever. Nothing is left to do once the table is
    // printed, so exit rather than wait on requests we've already given up on.
    .then(() => process.exit(0))
    .catch(err => {
      console.error(`Fatal: ${(err as Error).message}`);
      process.exit(1);
    });
}
