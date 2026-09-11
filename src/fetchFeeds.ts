import 'dotenv/config';
import RSSParser from 'rss-parser';
import crypto from 'crypto';
import { openDb } from './db';
import { warn } from './logger';
import { isEventInWindow, compareByStartDate, countyLabel } from './region';
import { withTimeout } from './net';
import type { Article, Source } from './types';

const parser = new RSSParser({ timeout: 10000 });

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Hard ceiling per source, so one stalled feed can't hang the whole run. */
const SOURCE_TIMEOUT_MS = 20_000;

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function urlHash(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
}

/** Shared mapping from an rss-parser item to our Article shape. */
function toArticle(
  item: { title?: string; link?: string; pubDate?: string; contentSnippet?: string; content?: string; summary?: string },
  source: Source,
  asEvent: boolean
): Article {
  const rawSummary = item.contentSnippet ?? item.content ?? item.summary ?? '';
  const date = new Date(item.pubDate!);

  return {
    title: stripHtml(item.title ?? ''),
    summary: stripHtml(rawSummary).slice(0, 500),
    link: item.link ?? '',
    source: source.name,
    pubDate: date,
    ...(asEvent ? { eventDate: date } : {}),
    category: asEvent ? 'events' : source.category,
    urlHash: urlHash(item.link ?? ''),
    tier: source.tier,
    county: source.county,
  };
}

/**
 * RSS feeds are publish-dated: an item's date is when the article went up, so
 * the relevant window is the last 7 days, newest first.
 */
async function fetchRssSource(source: Source): Promise<Article[]> {
  const feed = await withTimeout(parser.parseURL(source.url), SOURCE_TIMEOUT_MS, source.name);
  const cutoff = Date.now() - SEVEN_DAYS_MS;

  return feed.items
    .filter(item => {
      if (!item.link || !item.title || !item.pubDate) return false;
      return new Date(item.pubDate).getTime() >= cutoff;
    })
    .map(item => toArticle(item, source, false));
}

/**
 * The Events Calendar (the WordPress plugin behind most local library, venue
 * and college calendars) publishes an RSS feed at /events/feed/ whose pubDate
 * is the event's START time, not its publish time. Same wire format as a
 * normal feed, opposite date semantics — so it needs the forward-looking
 * window, not the 7-day lookback. Verified against Osterhout Free Library and
 * Waverly Community House: both return future-dated items.
 */
async function fetchEventRssSource(source: Source): Promise<Article[]> {
  const feed = await withTimeout(parser.parseURL(source.url), SOURCE_TIMEOUT_MS, source.name);

  return feed.items
    .filter(item => !!item.link && !!item.title && !!item.pubDate)
    .map(item => toArticle(item, source, true))
    .filter(a => isEventInWindow(a.eventDate!))
    .sort(compareByStartDate);
}

/**
 * Calendar feeds are event-dated: an item's date is when the event *starts*,
 * which is in the future. These get their own look-ahead window and sort
 * soonest-first, and carry an explicit eventDate so the email can show it.
 */
async function fetchIcalSource(source: Source): Promise<Article[]> {
  const ical = await import('node-ical');
  const data = await withTimeout(
    ical.async.fromURL(source.url),
    SOURCE_TIMEOUT_MS,
    source.name
  );

  const articles: Article[] = [];

  for (const entry of Object.values(data)) {
    const ev = entry as any;
    if (ev.type !== 'VEVENT') continue;
    if (!ev.start || !ev.summary) continue;

    const start = new Date(ev.start);
    if (!isEventInWindow(start)) continue;

    // Not every calendar publishes a URL — fall back to the calendar itself so
    // the item still links somewhere useful, and so urlHash stays stable.
    const link = ev.url ?? `${source.url}#${ev.uid ?? start.toISOString()}`;

    const where = ev.location ? ` Location: ${stripHtml(String(ev.location))}.` : '';
    const description = ev.description ? stripHtml(String(ev.description)) : '';

    articles.push({
      title: stripHtml(String(ev.summary)),
      summary: `${description}${where}`.trim().slice(0, 500),
      link,
      source: source.name,
      pubDate: start,
      eventDate: start,
      category: 'events',
      urlHash: urlHash(link),
      tier: source.tier,
      county: source.county,
    });
  }

  return articles.sort(compareByStartDate);
}

async function fetchSource(source: Source): Promise<Article[]> {
  try {
    switch (source.type) {
      case 'ical':      return await fetchIcalSource(source);
      case 'event-rss': return await fetchEventRssSource(source);
      default:          return await fetchRssSource(source);
    }
  } catch (err) {
    warn(`Failed to fetch "${source.name}": ${(err as Error).message}`);
    return [];
  }
}

export async function fetchAndNormalize(): Promise<Article[]> {
  const db = openDb();

  const sources = db
    .prepare(
      'SELECT id, name, url, type, category, active, tier, county FROM sources WHERE active = 1'
    )
    .all() as Source[];

  const sentHashes = new Set<string>(
    (db.prepare('SELECT url_hash FROM sent_log').all() as { url_hash: string }[]).map(
      r => r.url_hash
    )
  );

  db.close();

  console.log(`Fetching ${sources.length} active source(s)...`);

  const results = await Promise.allSettled(sources.map(fetchSource));

  const allArticles: Article[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') allArticles.push(...result.value);
  }

  // dedupe within this batch and against sent_log
  const seenHashes = new Set<string>();
  const fresh = allArticles.filter(a => {
    if (sentHashes.has(a.urlHash) || seenHashes.has(a.urlHash)) return false;
    seenHashes.add(a.urlHash);
    return true;
  });

  // Dated calendar events sort soonest-first; everything else newest-first.
  // Keeping them in separate blocks stops a concert two weeks out from
  // outranking this morning's news.
  const datedEvents = fresh.filter(a => a.eventDate).sort(compareByStartDate);
  const rest = fresh
    .filter(a => !a.eventDate)
    .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

  return [...datedEvents, ...rest];
}

// CLI entrypoint: npm run fetch
if (require.main === module) {
  (async () => {
    const articles = await fetchAndNormalize();
    console.log(`\nFetched ${articles.length} fresh article(s):\n`);
    for (const a of articles) {
      const county = countyLabel(a.county);
      console.log(`[${a.category.toUpperCase()}] T${a.tier} ${a.source}${county ? ` (${county})` : ''}`);
      console.log(`  Title   : ${a.title}`);
      console.log(`  ${a.eventDate ? 'Starts  ' : 'Date    '}: ${a.pubDate.toLocaleDateString()}`);
      console.log(`  Link    : ${a.link}`);
      console.log(`  Summary : ${a.summary.slice(0, 120)}...`);
      console.log();
    }

    const byTier = articles.reduce<Record<number, number>>((acc, a) => {
      acc[a.tier] = (acc[a.tier] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`By tier: ${JSON.stringify(byTier)}`);
    console.log(`Dated calendar events: ${articles.filter(a => a.eventDate).length}`);
  })();
}
