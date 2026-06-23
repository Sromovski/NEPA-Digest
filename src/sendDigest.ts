import 'dotenv/config';
import { Resend } from 'resend';
import { fetchAndNormalize } from './fetchFeeds';
import { buildDigests } from './rankAndSummarize';
import { renderDigestEmail } from './emailTemplate';
import { fetchWeather } from './fetchWeather';
import { fetchCalendarEvents } from './fetchCalendar';
import { openDb } from './db';
import { log, error } from './logger';
import type { RankedArticle } from './rankAndSummarize';
import type { WeatherForecast } from './fetchWeather';
import type { CalendarEvent } from './fetchCalendar';

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function dateRange(): string {
  const end   = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}`;
}

function logSentArticles(articles: RankedArticle[]): void {
  const db = openDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO sent_log (url_hash, article_url, title, source_name)
    VALUES (@url_hash, @article_url, @title, @source_name)
  `);
  const insertAll = db.transaction((items: RankedArticle[]) => {
    for (const { article } of items) {
      insert.run({
        url_hash:    article.urlHash,
        article_url: article.link,
        title:       article.title,
        source_name: article.source,
      });
    }
  });
  insertAll(articles);
  db.close();
}

async function sendEmail(
  resend: Resend,
  to: string,
  subject: string,
  html: string
): Promise<void> {
  const fromEmail = requireEnv('FROM_EMAIL');
  const { error: resendError } = await resend.emails.send({ from: fromEmail, to, subject, html });
  if (resendError) throw new Error(JSON.stringify(resendError));
}

export async function run(testMode: boolean): Promise<void> {
  const startTime = Date.now();
  log(`--- Digest run started (${testMode ? 'TEST' : 'LIVE'}) ---`);

  // Validate all required env vars up front
  requireEnv('RESEND_API_KEY');
  requireEnv('FROM_EMAIL');
  if (testMode) requireEnv('TEST_EMAIL');

  const resend    = new Resend(process.env.RESEND_API_KEY);
  const testEmail = process.env.TEST_EMAIL ?? '';
  const range     = dateRange();

  // 1. Fetch weather, calendar, and feeds in parallel
  log('Fetching weather and calendar...');
  let weather: WeatherForecast | undefined;
  let calendarEvents: CalendarEvent[] = [];

  [weather, calendarEvents] = await Promise.all([
    fetchWeather().catch(err => {
      error(`Weather fetch failed (continuing without it): ${(err as Error).message}`);
      return undefined;
    }),
    fetchCalendarEvents().catch(err => {
      error(`Calendar fetch failed (continuing without it): ${(err as Error).message}`);
      return [];
    }),
  ]);

  if (weather) log(`Weather fetched: ${weather.days.length} day(s).`);
  log(`Calendar fetched: ${calendarEvents.length} event(s).`);

  log('Fetching feeds...');
  const articles = await fetchAndNormalize();
  log(`${articles.length} fresh article(s) fetched.`);

  // 2. Rank + summarize
  log('Ranking and summarizing...');
  const digests = await buildDigests(articles);

  // 3. Send
  log('Sending emails...');
  const allSent: RankedArticle[] = [];
  let sentCount = 0;
  let failCount = 0;

  for (const { member, articles: ranked } of digests) {
    const recipients = testMode
      ? [testEmail]
      : [member.email, member.alternate_email].filter((e): e is string => !!e);
    const subject = `Luzerne County Weekly Digest — ${member.name} — ${range}`;
    const html    = renderDigestEmail(member, ranked, range, weather, calendarEvents);

    try {
      for (const recipient of recipients) {
        await sendEmail(resend, recipient, subject, html);
      }
      const label = testMode
        ? `${member.name} → ${recipients.join(', ')} (test)`
        : `${member.name} → ${recipients.join(', ')}`;
      log(`Sent: ${label} — ${ranked.length} article(s)`);
      allSent.push(...ranked);
      sentCount++;
    } catch (err) {
      error(`Failed to send for ${member.name}: ${(err as Error).message}`);
      failCount++;
    }
  }

  // 4. Log sent articles — dedupe across members, skip in test mode
  if (!testMode && allSent.length > 0) {
    const seenHashes = new Set<string>();
    const deduped = allSent.filter(r => {
      if (seenHashes.has(r.article.urlHash)) return false;
      seenHashes.add(r.article.urlHash);
      return true;
    });
    logSentArticles(deduped);
    log(`Logged ${deduped.length} article(s) to sent_log.`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`--- Run complete in ${elapsed}s | sent: ${sentCount} | failed: ${failCount} ---`);
}

// CLI entrypoint
if (require.main === module) {
  const testMode = process.argv.includes('--test');
  run(testMode).catch(err => {
    error(`Fatal: ${(err as Error).message}`);
    process.exit(1);
  });
}
