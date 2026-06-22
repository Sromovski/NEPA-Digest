# CLAUDE.md — Luzerne County Weekly Digest

This file gives Claude Code full context for this project. Keep it up to date
as decisions change — Claude Code reads this on every session.

---

## 1. Project Summary

A self-hosted Node.js app that:
1. Pulls local news, community events, farmers market listings, and sports
   coverage (SWB RailRiders Triple-A baseball) for **Luzerne County, PA**
   (Wilkes-Barre, Hazleton, Wyoming Valley area).
2. Filters and ranks items against two audience profiles — **Adults** and
   **Children** — using the Claude API for semantic interest matching.
3. Generates a weekly personalized HTML email digest per audience with
   summaries and direct links back to original source articles.
4. Sends via **Resend** on a weekly cron schedule (Sunday 7 AM Eastern).

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
| Scheduler | `node-cron` — Sunday 7 AM Eastern |
| Config/secrets | `.env` file (never committed) |
| Deployment | Railway or always-on box running `npm start` |

---

## 3. Architecture / Pipeline

```
[1] FETCH        → pull all active RSS feeds from sources table
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

## 7. Copyright / Content Rules (IMPORTANT)

- **Never reproduce full article text.** Claude summaries must be 1-2
  sentences written in original words.
- **Always link to the original source** — digest drives traffic to
  publishers, does not replace reading them.
- **No paywall circumvention** — use the snippet the feed provides; never
  scrape behind paywalls.

---

## 8. Source Files

```
src/
  types.ts           — Article, Source, FamilyMember interfaces
  db.ts              — SQLite open + CREATE TABLE IF NOT EXISTS schema
  seed.ts            — DELETE + re-insert sources and family_members from JSON
  migrate.ts         — entry point: runs migrate() then seedFromFiles()
  logger.ts          — timestamped INFO/WARN/ERROR to console + logs/digest-YYYY-MM-DD.log
  fetchFeeds.ts      — fetch all active sources, normalize, dedupe, filter 7 days
  rankAndSummarize.ts — keyword pre-filter → Claude API ranking + summarization
  emailTemplate.ts   — renders table-based HTML email string
  sendDigest.ts      — orchestrates full pipeline; export run(testMode)
  scheduler.ts       — node-cron entry point; calls run(false) every Sunday 7AM ET
```

Config files:
```
sources.json     — RSS feed definitions (edit here, then npm run db:migrate)
family.json      — audience profiles (edit here, then npm run db:migrate)
.env             — secrets (never commit)
.env.example     — template for required env vars
data/digest.db   — SQLite database (gitignored)
logs/            — daily log files digest-YYYY-MM-DD.log (gitignored)
```

---

## 9. Environment Variables

```
ANTHROPIC_API_KEY=          # Anthropic API key
RESEND_API_KEY=             # Resend API key
FROM_EMAIL=digest@yourdomain.com
TEST_EMAIL=you@example.com  # recipient for --test mode
DB_PATH=./data/digest.db    # optional, defaults to ./data/digest.db
```

---

## 10. NPM Scripts

```bash
npm start             # start scheduler (runs every Sunday 7AM ET, stays alive)
npm run db:migrate    # apply schema + reseed sources and family_members from JSON
npm run fetch         # fetch + normalize feeds, print to console
npm run digest:test   # full pipeline → send to TEST_EMAIL only (no sent_log write)
npm run digest:send   # full pipeline → send to all members (writes sent_log)
```

---

## 11. Open Decisions

- [ ] Set real email addresses in `family.json` for Adults and Children
- [ ] Verify and enable WNEP / Times Leader / Citizens' Voice native RSS feeds
      as supplements to Google News (check site footers for feed URLs)
- [ ] Hosting: Railway vs home server vs GitHub Actions cron
- [ ] Day/time of weekly send (currently Sunday 7 AM Eastern — change in
      `src/scheduler.ts` SCHEDULE constant)
- [ ] Consider adding a `logs/` rotation policy (currently one file per day,
      no cleanup)
