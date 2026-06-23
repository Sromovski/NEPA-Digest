import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { openDb } from './db';
import { log, warn } from './logger';
import type { Article, FamilyMember } from './types';

export interface RankedArticle {
  article: Article;
  summary: string;
  matchReason: string;
  score: number;
}

export interface MemberDigest {
  member: FamilyMember;
  articles: RankedArticle[];
}

const client = new Anthropic();

const MAX_CANDIDATES = 30;
const MAX_PER_DIGEST = 8;
const MIN_SCORE = 5;

const STOP_WORDS = new Set([
  'local', 'about', 'their', 'there', 'where', 'which', 'would', 'could',
  'should', 'other', 'after', 'before', 'being', 'these', 'those',
]);

function keywordPreFilter(articles: Article[], interests: string[]): Article[] {
  const keywords = [
    ...interests.map(i => i.toLowerCase()),
    ...interests.flatMap(i =>
      i.toLowerCase().split(/\s+/).filter(w => w.length >= 5 && !STOP_WORDS.has(w))
    ),
  ];

  if (keywords.length === 0) return articles.slice(0, MAX_CANDIDATES);

  const matched = articles.filter(a => {
    const text = `${a.title} ${a.summary}`.toLowerCase();
    return keywords.some(kw => text.includes(kw));
  });

  return (matched.length >= 5 ? matched : articles).slice(0, MAX_CANDIDATES);
}

async function rankForMember(
  member: FamilyMember,
  candidates: Article[]
): Promise<RankedArticle[]> {
  if (candidates.length === 0) return [];

  const articleList = candidates
    .map(
      (a, i) =>
        `[${i}] Title: ${a.title}\n    Source: ${a.source}\n    Summary: ${a.summary}`
    )
    .join('\n\n');

  const prompt = `You are curating a personalized weekly news digest for ${member.name}, who lives in Northeastern Pennsylvania (NEPA).

Their interests: ${member.interests.join(', ')}

Below are ${candidates.length} local news articles. For each article provide:
1. A relevance score 0-10 (0 = not relevant to their interests, 10 = highly relevant)
2. A 1-2 sentence summary written entirely in your own words — never copy text verbatim
3. A brief reason explaining why it matches or doesn't match their interests

Return ONLY a valid JSON array with this exact structure (no markdown, no prose):
[
  { "index": 0, "score": 7, "summary": "...", "matchReason": "..." },
  ...
]

Articles:
${articleList}`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`Claude did not return a JSON array for ${member.name}`);

  const results: { index: number; score: unknown; summary: string; matchReason: string }[] =
    JSON.parse(jsonMatch[0]);

  return results
    .filter(r => Number(r.score) >= MIN_SCORE && candidates[r.index] != null)
    .map(r => ({
      article: candidates[r.index],
      summary: r.summary,
      matchReason: r.matchReason,
      score: Number(r.score),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PER_DIGEST);
}

export async function buildDigests(articles: Article[]): Promise<MemberDigest[]> {
  const db = openDb();
  const rows = db
    .prepare('SELECT id, name, email, alternate_email, interests FROM family_members WHERE active = 1')
    .all() as { id: number; name: string; email: string; interests: string }[];
  db.close();

  const members: FamilyMember[] = rows.map(r => ({
    ...r,
    interests: JSON.parse(r.interests) as string[],
  }));

  log(`Ranking articles for ${members.length} member(s)...`);

  const digests: MemberDigest[] = [];

  for (const member of members) {
    log(`  [${member.name}] interests: ${member.interests.join(', ')}`);
    const candidates = keywordPreFilter(articles, member.interests);
    log(`  [${member.name}] ${candidates.length} candidate(s) → sending to Claude...`);

    try {
      const ranked = await rankForMember(member, candidates);
      log(`  [${member.name}] ${ranked.length} article(s) selected`);
      digests.push({ member, articles: ranked });
    } catch (err) {
      warn(`Ranking failed for ${member.name}: ${(err as Error).message}`);
      digests.push({ member, articles: [] });
    }
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

    for (const { member, articles: ranked } of digests) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Digest for ${member.name}`);
      console.log('='.repeat(60));
      for (const { article, summary, matchReason, score } of ranked) {
        console.log(`\n  [${score}/10] ${article.title}`);
        console.log(`  Source : ${article.source} — ${article.pubDate.toLocaleDateString()}`);
        console.log(`  Summary: ${summary}`);
        console.log(`  Match  : ${matchReason}`);
        console.log(`  Link   : ${article.link}`);
      }
    }
  })();
}
