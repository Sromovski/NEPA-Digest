import 'dotenv/config';
import RSSParser from 'rss-parser';
import crypto from 'crypto';
import { openDb } from './db';
import { warn } from './logger';
import type { Article, Source } from './types';

const parser = new RSSParser({ timeout: 10000 });

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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

async function fetchSource(source: Source): Promise<Article[]> {
  try {
    const feed = await parser.parseURL(source.url);
    const cutoff = Date.now() - SEVEN_DAYS_MS;

    return feed.items
      .filter(item => {
        if (!item.link || !item.title || !item.pubDate) return false;
        return new Date(item.pubDate).getTime() >= cutoff;
      })
      .map(item => {
        const rawSummary = item.contentSnippet ?? item.content ?? item.summary ?? '';
        return {
          title: stripHtml(item.title ?? ''),
          summary: stripHtml(rawSummary).slice(0, 500),
          link: item.link ?? '',
          source: source.name,
          pubDate: new Date(item.pubDate!),
          category: source.category,
          urlHash: urlHash(item.link ?? ''),
        };
      });
  } catch (err) {
    warn(`Failed to fetch "${source.name}": ${(err as Error).message}`);
    return [];
  }
}

export async function fetchAndNormalize(): Promise<Article[]> {
  const db = openDb();

  const sources = db
    .prepare('SELECT id, name, url, type, category, active FROM sources WHERE active = 1')
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

  fresh.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

  return fresh;
}

// CLI entrypoint: npm run fetch
if (require.main === module) {
  (async () => {
    const articles = await fetchAndNormalize();
    console.log(`\nFetched ${articles.length} fresh article(s):\n`);
    for (const a of articles) {
      console.log(`[${a.category.toUpperCase()}] ${a.source}`);
      console.log(`  Title   : ${a.title}`);
      console.log(`  Date    : ${a.pubDate.toLocaleDateString()}`);
      console.log(`  Link    : ${a.link}`);
      console.log(`  Summary : ${a.summary.slice(0, 120)}...`);
      console.log();
    }
  })();
}
