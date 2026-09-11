import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { openDb } from './db';
import { log, warn } from './logger';
import { applyTierBonus, countyLabel, compareByStartDate } from './region';
import type { Article, FamilyMember } from './types';

export interface RankedArticle {
  article: Article;
  summary: string;
  matchReason: string;
  /** Tier-adjusted score used for ordering and the MIN_SCORE cut. */
  score: number;
  /** What Claude gave it, before the regional adjustment. */
  rawScore: number;
}

export interface MemberDigest {
  member: FamilyMember;
  events: RankedArticle[];
  news: RankedArticle[];
}

const client = new Anthropic();

/** Candidates sent to Claude per pass. Events and news get their own pool. */
const MAX_CANDIDATES = 60;

/** Items rendered per section — roughly 10-12 local items per email. */
const MAX_EVENTS = 6;
const MAX_NEWS = 6;

const MIN_SCORE = 5;

const STOP_WORDS = new Set([
  'local', 'about', 'their', 'there', 'where', 'which', 'would', 'could',
  'should', 'other', 'after', 'before', 'being', 'these', 'those',
]);

/**
 * Cheap pre-filter to decide what Claude sees first. Interest matches lead;
 * the rest top up the pool so a full MAX_CANDIDATES always goes out. The old
 * version dropped everything past the first 30 by date, which meant a busy
 * news day could push every event out of the pool before ranking even began.
 */
export function keywordPreFilter(articles: Article[], interests: string[]): Article[] {
  if (interests.length === 0) return articles.slice(0, MAX_CANDIDATES);

  const keywords = [
    ...interests.map(i => i.toLowerCase()),
    ...interests.flatMap(i =>
      i.toLowerCase().split(/\s+/).filter(w => w.length >= 5 && !STOP_WORDS.has(w))
    ),
  ];

  const matched: Article[] = [];
  const unmatched: Article[] = [];

  for (const a of articles) {
    const text = `${a.title} ${a.summary}`.toLowerCase();
    (keywords.some(kw => text.includes(kw)) ? matched : unmatched).push(a);
  }

  return [...matched, ...unmatched].slice(0, MAX_CANDIDATES);
}

function describe(a: Article, i: number): string {
  const county = countyLabel(a.county);
  const where = county ? county : 'Luzerne County';
  const when = a.eventDate
    ? `    Starts: ${a.eventDate.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric',
      })}\n`
    : '';
  return (
    `[${i}] Title: ${a.title}\n` +
    `    Source: ${a.source} (${where})\n` +
    when +
    `    Summary: ${a.summary}`
  );
}

async function rankPass(
  member: FamilyMember,
  candidates: Article[],
  kind: 'events' | 'news',
  limit: number
): Promise<RankedArticle[]> {
  if (candidates.length === 0) return [];

  const articleList = candidates.map(describe).join('\n\n');

  const kindGuidance =
    kind === 'events'
      ? `These are upcoming events and things to do. Favor items a reader could actually attend: a date, a place, and something to show up for. Down-score items that merely mention an event in passing or that have already happened.`
      : `These are local news and sports stories. Favor items that affect daily life in the region — decisions, developments, results, closures, openings.`;

  const prompt = `You are curating a personalized weekly digest for ${member.name}, who lives in Luzerne County, Northeastern Pennsylvania.

The digest covers Luzerne County plus surrounding counties within about 50 miles — Lackawanna, Wyoming, Columbia, Carbon, Monroe, Schuylkill, Sullivan, Susquehanna, Wayne, Montour, and at the outer edge Pike, Lehigh, Northampton, Northumberland and Bradford. Each item below is labeled with its county.

Their interests: ${member.interests.join(', ')}

${kindGuidance}

Judge each item on interest match and general usefulness to this reader. Do NOT adjust for distance — the county is shown for your context and for your summary wording, but distance is weighted separately after you score.

For each item provide:
1. A relevance score 0-10 (0 = not relevant to their interests, 10 = highly relevant)
2. A 1-2 sentence summary written entirely in your own words — never copy text verbatim. If the item is outside Luzerne County, name the town or county in the summary so the reader knows where it is.
3. A brief reason explaining why it matches or doesn't match their interests

Return ONLY a valid JSON array with this exact structure (no markdown, no prose):
[
  { "index": 0, "score": 7, "summary": "...", "matchReason": "..." },
  ...
]

Items:
${articleList}`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`Claude did not return a JSON array for ${member.name} (${kind})`);
  }

  const results: { index: number; score: unknown; summary: string; matchReason: string }[] =
    JSON.parse(jsonMatch[0]);

  const ranked = results
    .filter(r => candidates[r.index] != null)
    .map(r => {
      const article = candidates[r.index];
      const rawScore = Number(r.score);
      return {
        article,
        summary: r.summary,
        matchReason: r.matchReason,
        rawScore,
        score: applyTierBonus(rawScore, article.tier),
      };
    })
    .filter(r => !Number.isNaN(r.score) && r.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Events read better in date order once the cut is made; news stays by score.
  if (kind === 'events') {
    ranked.sort((a, b) => {
      if (a.article.eventDate && b.article.eventDate) {
        return compareByStartDate(
          { pubDate: a.article.eventDate },
          { pubDate: b.article.eventDate }
        );
      }
      if (a.article.eventDate) return -1;
      if (b.article.eventDate) return 1;
      return b.score - a.score;
    });
  }

  return ranked;
}

export async function buildDigests(articles: Article[]): Promise<MemberDigest[]> {
  const db = openDb();
  const rows = db
    .prepare('SELECT id, name, email, additional_emails, interests FROM family_members WHERE active = 1')
    .all() as {
      id: number;
      name: string;
      email: string;
      additional_emails: string;
      interests: string;
    }[];
  db.close();

  const members: FamilyMember[] = rows.map(r => ({
    ...r,
    additional_emails: JSON.parse(r.additional_emails) as string[],
    interests: JSON.parse(r.interests) as string[],
  }));

  const eventPool = articles.filter(a => a.category === 'events');
  const newsPool = articles.filter(a => a.category !== 'events');

  log(
    `Ranking for ${members.length} member(s) — ` +
      `${eventPool.length} event candidate(s), ${newsPool.length} news candidate(s)`
  );

  const digests: MemberDigest[] = [];

  for (const member of members) {
    log(`  [${member.name}] interests: ${member.interests.join(', ')}`);

    const eventCandidates = keywordPreFilter(eventPool, member.interests);
    const newsCandidates = keywordPreFilter(newsPool, member.interests);
    log(
      `  [${member.name}] sending ${eventCandidates.length} event(s) + ` +
        `${newsCandidates.length} news item(s) to Claude...`
    );

    // Separate try/catch per pass — a failed events pass must not also wipe
    // out the news section, and vice versa.
    const [events, news] = await Promise.all([
      rankPass(member, eventCandidates, 'events', MAX_EVENTS).catch(err => {
        warn(`Events ranking failed for ${member.name}: ${(err as Error).message}`);
        return [] as RankedArticle[];
      }),
      rankPass(member, newsCandidates, 'news', MAX_NEWS).catch(err => {
        warn(`News ranking failed for ${member.name}: ${(err as Error).message}`);
        return [] as RankedArticle[];
      }),
    ]);

    log(`  [${member.name}] ${events.length} event(s) + ${news.length} news item(s) selected`);
    digests.push({ member, events, news });
  }

  return digests;
}

// CLI entrypoint: ts-node src/rankAndSummarize.ts
if (require.main === module) {
  (async () => {
    const { fetchAndNormalize } = await import('./fetchFeeds');

    const articles = await fetchAndNormalize();
    console.log(`\nFetched ${articles.length} article(s). Running ranking...\n`);

    const digests = await buildDigests(articles);

    for (const { member, events, news } of digests) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Digest for ${member.name}`);
      console.log('='.repeat(60));

      for (const [label, items] of [['EVENTS', events], ['NEWS', news]] as const) {
        console.log(`\n--- ${label} ---`);
        for (const { article, summary, matchReason, score, rawScore } of items) {
          const county = countyLabel(article.county);
          console.log(`\n  [${score.toFixed(1)}/10 raw ${rawScore} T${article.tier}] ${article.title}`);
          console.log(`  Source : ${article.source}${county ? ` — ${county}` : ''}`);
          console.log(`  Summary: ${summary}`);
          console.log(`  Match  : ${matchReason}`);
          console.log(`  Link   : ${article.link}`);
        }
      }
    }
  })();
}
