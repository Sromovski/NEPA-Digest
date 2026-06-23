# CLAUDE.md — Luzerne County Weekly Digest

This file gives Claude Code full context for this project. Keep it up to date
as decisions change — Claude Code reads this on every session.

---

## 1. Project Summary

A self-hosted Node.js app that:
1. Pulls local news, community events, farmers market listings, and sports
   coverage (SWB RailRiders Triple-A baseball) for **Luzerne County, PA**
   (Wilkes-Barre, Hazleton, Wyoming Valley area).
2. Fetches a 7-day weather forecast (Open-Meteo, no API key) and upcoming
   Google Calendar events for the week.
3. Filters and ranks news items against two audience profiles — **Adults** and
   **Children** — using the Claude API for semantic interest matching.
4. Generates a personalized HTML email digest per audience with weather,
   calendar events, article summaries, and direct links back to sources.
5. Sends via **Resend** on a daily cron schedule (7 AM Eastern, temporarily
   daily for performance testing — will revert to Sunday-only).

Personal project — no paywall scraping, no full article reproduction,
headline + original-words summary + link only.

---

## 2. Tech Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js 20+ / TypeScript |
| Feed parsing | `rss-parser` |
| AI ranking + summarization | Anthropic API — `claude-sonnet-4-6` |
| Email delivery | **Resend** (`resend` npm package) |
| Database | SQLite via `better-sqlite3` |
| Weather | Open-Meteo API (free, no key, Dallas PA coords) |
| Calendar | Google Calendar API via `googleapis` + service account |
| Scheduler | `node-cron` — daily 7 AM Eastern (temp); revert to Sunday |
| Process manager | **PM2** — `ecosystem.config.js`, runs `npm start` via node + ts-node/register |
| Config/secrets | `.env` file (never committed) |
| Deployment | Always-on Windows machine running PM2 |

---

## 3. Architecture / Pipeline

```
[1] FETCH        → pull all active RSS feeds from sources table
                   + fetch 7-day weather (Open-Meteo)
                   + fetch upcoming Google Calendar events (next 7 days)
[2] NORMALIZE    → dedupe, strip HTML, standardize
                   {title, summary, link, source, pubDate, category, urlHash}
[3] FILTER       → drop items older than 7 days
                   drop already-sent items (check sent_log by URL hash)
[4] KEYWORD FILTER → cheap keyword pre-filter per audience to reduce
                   Claude API calls (falls back to full list if < 5 matches)
[5] RANK/MATCH   → Claude API scores each candidate article 0-10 against
                   the audience's interest tags; drops score < 5
[6] SUMMARIZE    → Claude writes a 1-2 sentence original-words summary per
                   article (never verbatim — copyright rule)
[7] RENDER       → build personalized HTML email per audience profile
                   (includes weather strip + calendar events section)
[8] SEND         → dispatch via Resend API
[9] LOG          → record sent article URL hashes in sent_log (live runs only)
```

Each audience profile gets its own personalized email.
Test mode (`--test`) sends all emails to `TEST_EMAIL` and skips sent_log.

---

## 4. Data Sources (Luzerne County)

All active sources use Google News RSS (no API key, no maintenance):

| Name | Category | Focus |
|---|---|---|
| Google News - Luzerne County | news | General county news |
| Google News - Wilkes-Barre | news | City-level coverage |
| Google News - Hazleton PA | news | Southern Luzerne County |
| Google News - Wyoming Valley Events | events | Regional events |
| Google News - Luzerne County Events | events | County events |
| Google News - Farmers Markets NEPA | events | Farmers market listings |
| Google News - SWB RailRiders | sports | Triple-A Yankees affiliate |
| Google News - Luzerne County Sports | sports | Local sports |
| Google News - Family Events NEPA | events | Family/kids events |

Sources are stored in `sources.json` and seeded into the `sources` table via
`npm run db:migrate`. Set `"active": false` to disable a source without
removing it.

To add a source, append to `sources.json` and re-run `npm run db:migrate`
(the seed step clears and re-inserts the sources table).

---

## 5. Audience Profiles

Defined in `family.json`, seeded into the `family_members` table.
Re-run `npm run db:migrate` after editing to apply changes.

```json
{
  "members": [
    {
      "name": "Adults",
      "email": "adults@yourdomain.com",
      "interests": [
        "farmers markets", "social events", "community happenings",
        "local government", "RailRiders baseball", "arts and culture",
        "festivals", "Wilkes-Barre", "Hazleton", "Luzerne County"
      ]
    },
    {
      "name": "Children",
      "email": "children@yourdomain.com",
      "interests": [
        "RailRiders baseball", "youth sports", "family events",
        "kids activities", "summer camps", "parks and recreation",
        "library programs", "school events", "fairs and festivals"
      ]
    }
  ]
}
```

Interests are free-text tags. Claude handles semantic matching — e.g.
"RailRiders" matches "SWB RailRiders" or "Triple-A" articles.

---

## 6. Email Delivery — Resend

Provider is **Resend**. Do not add a second provider.

- Package: `resend`
- API key: `RESEND_API_KEY` in `.env`
- Sending domain must be verified in the Resend dashboard
- Template: table-based HTML, inline styles only, max 600px wide
- Subject format: `Luzerne County Weekly Digest — {Name} — {Date range}`
- Footer includes attribution note and reply-to unsubscribe instruction

---

## 7. Weather — Open-Meteo

No API key required. Hardcoded coordinates for Dallas, PA (41.3367, -75.9638).
Returns 7-day forecast with high/low temps (°F) and WMO weather code mapped
to emoji + description. Fetched in `src/fetchWeather.ts`.

---

## 8. Google Calendar Integration

- Package: `googleapis`
- Auth: service account JSON key stored at `./nepa-digest-e28c54d4aa7b.json`
  (gitignored via `nepa-digest-*.json` pattern — never commit this file)
- `GOOGLE_SERVICE_ACCOUNT_KEY` in `.env` holds the **file path** to the JSON key.
  `fetchCalendar.ts` detects whether the value starts with `{` (inline JSON,
  legacy) or is a file path and loads accordingly.
- `GOOGLE_CALENDAR_ID` in `.env` holds the target calendar ID.
- Fetches events for the next 7 days, up to 25 results.
- Both vars are optional — if absent, calendar section is silently skipped.

---

## 9. Copyright / Content Rules (IMPORTANT)

- **Never reproduce full article text.** Claude summaries must be 1-2
  sentences written in original words.
- **Always link to the original source** — digest drives traffic to
  publishers, does not replace reading them.
- **No paywall circumvention** — use the snippet the feed provides; never
  scrape behind paywalls.

---

## 10. Source Files

```
src/
  types.ts             — Article, Source, FamilyMember interfaces
  db.ts                — SQLite open + CREATE TABLE IF NOT EXISTS schema
  seed.ts              — DELETE + re-insert sources and family_members from JSON
  migrate.ts           — entry point: runs migrate() then seedFromFiles()
  logger.ts            — timestamped INFO/WARN/ERROR to console + logs/digest-YYYY-MM-DD.log
  fetchFeeds.ts        — fetch all active sources, normalize, dedupe, filter 7 days
  fetchWeather.ts      — 7-day forecast from Open-Meteo (no API key, Dallas PA)
  fetchCalendar.ts     — upcoming events from Google Calendar via service account
  rankAndSummarize.ts  — keyword pre-filter → Claude API ranking + summarization
  emailTemplate.ts     — renders table-based HTML email (weather + calendar + articles)
  sendDigest.ts        — orchestrates full pipeline; export run(testMode)
  scheduler.ts         — node-cron entry point; SCHEDULE constant controls frequency
```

Config files:
```
sources.json              — RSS feed definitions (edit here, then npm run db:migrate)
family.json               — audience profiles (edit here, then npm run db:migrate)
ecosystem.config.js       — PM2 process config (node + ts-node/register on Windows)
.env                      — secrets (never commit)
.env.example              — template for required env vars
nepa-digest-*.json        — Google service account key (gitignored, never commit)
data/digest.db            — SQLite database (gitignored)
logs/                     — daily log files digest-YYYY-MM-DD.log (gitignored)
```

---

## 11. Environment Variables

```
ANTHROPIC_API_KEY=              # Anthropic API key
RESEND_API_KEY=                 # Resend API key
FROM_EMAIL=digest@yourdomain.com
TEST_EMAIL=you@example.com      # recipient for --test mode
DB_PATH=./data/digest.db        # optional, defaults to ./data/digest.db

# Google Calendar (optional — omit both to skip calendar section)
GOOGLE_CALENDAR_ID=             # Google Calendar ID
GOOGLE_SERVICE_ACCOUNT_KEY=./nepa-digest-e28c54d4aa7b.json  # path to service account JSON
```

---

## 12. NPM Scripts

```bash
npm start             # start scheduler (stays alive, fires per SCHEDULE in scheduler.ts)
npm run db:migrate    # apply schema + reseed sources and family_members from JSON
npm run fetch         # fetch + normalize feeds, print to console
npm run digest:test   # full pipeline → send to TEST_EMAIL only (no sent_log write)
npm run digest:send   # full pipeline → send to all members (writes sent_log)
```

---

## 13. Process Management — PM2

The app runs under PM2 on a local Windows machine.

```bash
pm2 start ecosystem.config.js   # start the scheduler
pm2 status                       # check running status
pm2 logs nepa-digest             # live log tail
pm2 restart nepa-digest          # restart after code changes
pm2 stop nepa-digest             # stop
pm2 save                         # persist process list across reboots
pm2 startup                      # register PM2 as Windows startup service (run once)
```

`ecosystem.config.js` uses `interpreter: 'node'` with
`interpreter_args: '--require ts-node/register'` — required on Windows because
the `node_modules/.bin/ts-node` shim is a Unix shell script that Node can't
execute directly.

PM2 memory usage is ~1.9 GB at idle due to ts-node loading TypeScript. This is
expected and not a problem unless the machine is memory-constrained. If it
becomes an issue, add a build step and run compiled JS instead.

---

## 14. Open Decisions

- [ ] Set real email addresses in `family.json` for Adults and Children
- [ ] Revert scheduler to Sunday 7 AM only (`0 7 * * 0`) after daily testing period
- [ ] Verify and enable WNEP / Times Leader / Citizens' Voice native RSS feeds
      as supplements to Google News (check site footers for feed URLs)
- [ ] Set up `pm2 startup` to survive Windows reboots (run `pm2 startup` and
      follow the printed instructions)
- [ ] Consider adding a `logs/` rotation policy (currently one file per day,
      no cleanup)
