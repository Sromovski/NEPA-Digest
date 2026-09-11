# CLAUDE.md — Luzerne County Weekly Digest

This file gives Claude Code full context for this project. Keep it up to date
as decisions change — Claude Code reads this on every session.

---

## 1. Project Summary

A self-hosted Node.js app that:
1. Pulls national headlines (NPR) and local news, community events, farmers
   market listings, and sports coverage (SWB RailRiders Triple-A baseball)
   for **Luzerne County, PA and every county within ~50 miles** — see §4a for
   the tier map. Home base is the Wilkes-Barre / Hazleton / Wyoming Valley area.
2. Fetches a 7-day weather forecast (Open-Meteo, no API key) and upcoming
   Google Calendar events for the week.
3. Filters and ranks local news against two audience profiles — **Adults** and
   **Children** — using the Claude API for semantic interest matching.
4. Generates a personalized HTML email digest per audience: weather → calendar
   → national headlines → local news.
5. Sends via **Resend** (`hello@sromovski.com`) on a daily cron at 7 AM
   Eastern (temporary — will revert to Sunday-only after testing).

Personal project — no paywall scraping, no full article reproduction,
headline + original-words summary + link only.

---

## 2. Tech Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js 20+ / TypeScript |
| Feed parsing | `rss-parser` (RSS) + `node-ical` (.ics calendars) — see §4b |
| AI ranking + summarization | Anthropic API — `claude-sonnet-4-6` |
| Email delivery | **Resend** — verified domain `sromovski.com`, FROM `hello@sromovski.com` |
| Database | SQLite via `better-sqlite3` |
| Weather | Open-Meteo API (free, no key, Dallas PA coords) |
| Calendar | Google Calendar API via `googleapis` + service account |
| Scheduler | `node-cron` — daily 7 AM Eastern (temp); revert to `0 7 * * 0` |
| Process manager | **PM2** — `ecosystem.config.js`, node + ts-node/register |
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
[4] SPLIT        → national (category=national): top 6 by date, no AI ranking
                   local events (category=events) and local news/sports each
                   get their OWN pool — see §4b
[5] KEYWORD FILTER → per audience, interest matches lead and the remainder
                   tops up the pool to MAX_CANDIDATES (60) so a busy news
                   day can never starve the events pool
[6] RANK/MATCH   → Claude scores each candidate 0-10 against the audience's
                   interest tags. TWO passes per member (events, news), each
                   with its own try/catch. Tier bonus is applied AFTER
                   scoring (§4a), then score < 5 is dropped
[7] SUMMARIZE    → Claude writes a 1-2 sentence original-words summary per
                   article (never verbatim — copyright rule), naming the town
                   or county when the item is outside Luzerne
[8] RENDER       → build personalized HTML email per audience profile
                   order: weather → calendar → national → grocery (test only)
                          → Events & Things To Do → Around the Region
[9] SEND         → dispatch via Resend; each recipient gets its own try/catch
                   so one bad address never blocks the others
[10] LOG         → record sent article URL hashes in sent_log (live runs only)
```

Each audience profile gets its own personalized email.
Test mode (`--test`) sends all emails to `TEST_EMAIL` and skips sent_log.

**Known limitation:** `sent_log` is global — articles sent to any member are
marked sent for all members. Fix (make per-member) is an open decision below.

---

## 4. Data Sources

### National (non-partisan wire)
| Name | Category | Status |
|---|---|---|
| NPR News - Top Stories | national | Active |
| Reuters - Top News | national | Disabled — DNS blocked on host machine |
| AP News - Top Stories | national | Disabled — DNS blocked on host machine |

National articles are NOT ranked by Claude — top 6 by recency are shown as
plain headline links in a purple section.

### Local — Luzerne County + 50-mile radius

Local sources are **tiered by county** rather than listed individually here;
`sources.json` is the source of truth. As of the 2026-09-10 widening there are
46 active sources: 41 plain RSS and 5 event calendars.

To see exactly what is configured and whether it still works:

```bash
npm run sources:probe    # hits EVERY source (active or not), prints item counts
```

---

## 4a. Regional Tiers (IMPORTANT)

Distances are measured from Luzerne's **border**, not from Wilkes-Barre center.

| Tier | Counties | Score adjustment |
|---|---|---|
| **1** | Luzerne | **+1.5** |
| **2** | Lackawanna, Wyoming, Columbia, Carbon, Monroe, Schuylkill, Sullivan, Susquehanna, Wayne, Montour | **0** |
| **3** | Pike, Northampton, Lehigh, Northumberland, Bradford | **−1.0** |

The tier bonus is applied in `applyTierBonus()` (`src/region.ts`) **after**
Claude has scored an article, then clamped to 0-10, then the `MIN_SCORE = 5`
cut is applied. It costs nothing — no extra API call.

Claude is explicitly told **not** to adjust for distance. The county is passed
into the prompt only so it can name the town in the summary. Distance is
handled here, deterministically, so the weighting stays predictable.

Net effect: a 6/10 Wilkes-Barre story (→ 7.5) outranks a 7/10 Allentown story
(→ 6.0), but a genuinely great Scranton event still beats a dull local one.

Unknown or missing counties default to **tier 2**. To change the map, edit
`COUNTY_TIERS` in `src/region.ts` — `tierFor()` is case-insensitive.

---

## 4b. Source Types & Date Semantics (IMPORTANT)

The `type` field in `sources.json` controls **both** how a source is fetched
and **how its dates are interpreted**. Getting this wrong is the single
easiest way to break the events section.

| `type` | Fetched with | What `pubDate` means | Window |
|---|---|---|---|
| `rss` | `rss-parser` | when the article was **published** | last 7 days, newest first |
| `event-rss` | `rss-parser` | when the event **starts** | next 14 days, soonest first |
| `ical` | `node-ical` | `VEVENT` start time | next 14 days, soonest first |

**Why `event-rss` exists.** The Events Calendar — the WordPress plugin behind
most local library, venue, and college calendars — publishes at
`/events/feed/` in ordinary RSS, but sets `pubDate` to the event's **start
time**, which is in the future. Same wire format as a news feed, opposite date
semantics. Treating one of these as `type: "rss"` puts a concert two weeks out
at the top of the digest, above this morning's news.

Verified example (Osterhout Free Library, checked 2026-09-10):
`<title>Pokemon Day</title>` with `<pubDate>Sat, 12 Sep 2026 14:00:00</pubDate>`.

Event windowing lives in `isEventInWindow()` (`src/region.ts`). The floor is
the **start of the run day**, not `now`, so a 7 AM run still shows tonight's
concert.

**GOTCHA — recurring events arrive as one item PER OCCURRENCE.** Waverly
Community House emits `/event/fall-farmers-market/2026-09-11/` and
`/2026-09-18/` as two separate items with two different URLs, so the urlHash
dedupe cannot tell they are the same event. Left alone, a weekly event eats
two of the six event slots and a daily one could eat the entire section —
this shipped briefly on 2026-09-11 and put "Fall Farmer's Market" in the
digest twice. `collapseRecurringEvents()` (`src/region.ts`) keys on
**source + normalized title** (not URL — the date sits in a different part of
the path on every platform) and keeps only the soonest upcoming occurrence.
Undated items are never collapsed: two outlets legitimately run the same
headline.

### Verified event calendars

Probed 2026-09-10. Most `/events/feed/` guesses 404 — **always probe before
activating.**

| Source | Type | Tier |
|---|---|---|
| Osterhout Free Library | `event-rss` | 1 |
| Keystone College | `event-rss` | 2 |
| Scranton Cultural Center | `event-rss` | 2 |
| Waverly Community House | `event-rss` | 2 |
| ArtsQuest (Bethlehem) | `event-rss` | 3 |
| F.M. Kirby Center (blog, publish-dated) | `rss` | 1 |
| Luzerne County Library System (blog) | `rss` | 1 |

**Known 403 (bot-blocked, worth retrying later):** DiscoverNEPA,
Pocono Mountains Visitors Bureau, Visit NEPA. DiscoverNEPA in particular shows
up constantly in Google News results as an event listing site — if its
Cloudflare rule ever relaxes it would be the single best event source in the
region.

### Adding a source

1. Append to `sources.json` with `name`, `url`, `type`, `category`, `active`,
   `tier`, and `county`.
2. `npm run sources:probe` — confirm it returns items, and check the date
   column reads `Nd ahead` (an event feed) vs `Nd ago` (a news feed).
   **That column is how you pick between `rss` and `event-rss`.**
3. `npm run db:migrate` to reseed.

`tier` may be omitted — `seedFromFiles()` falls back to `tierFor(county)`.

---

## 5. Audience Profiles

Defined in `family.json`, seeded into the `family_members` table.
Re-run `npm run db:migrate` after editing to apply changes.

Each member supports an optional `additional_emails` array — every address in
it receives the same digest alongside the primary `email`, each in its own
Resend call with its own error handling, so one bad address never blocks the
others. Stored in the DB as a JSON array in the `additional_emails` column.
(This replaced the older single `alternate_email` field.)

```json
{
  "members": [
    {
      "name": "Adults",
      "email": "primary@example.com",
      "additional_emails": ["second@example.com", "third@example.com"],
      "interests": ["farmers markets", "RailRiders baseball", "Luzerne County", ...]
    },
    {
      "name": "Children",
      "email": "kids@example.com",
      "interests": ["RailRiders baseball", "youth sports", "family events", ...]
    }
  ]
}
```

Interests are free-text tags. Claude handles semantic matching.

---

## 6. Email Delivery — Resend

Provider is **Resend**. Do not add a second provider.

- Package: `resend`
- API key: `RESEND_API_KEY` in `.env`
- Verified domain: `sromovski.com` — confirmed active in Resend dashboard
- FROM address: `hello@sromovski.com` (set in `FROM_EMAIL` env var)
- Template: table-based HTML, inline styles only, max 600px wide
- Subject format: `NEPA Weekly Digest — {Name} — {Date range}`
  (renamed 2026-09-10 — the digest is no longer Luzerne-only)
- Each recipient gets its own `try/catch` — one bad address won't block others

**Important:** When `.env` changes, restart PM2 with `--update-env` or the
running process will keep the old values. Plain `pm2 restart` does NOT reload
environment variables.

---

## 7. Weather — Open-Meteo

No API key required. Hardcoded coordinates for Dallas, PA (41.3367, -75.9638).
Returns 7-day forecast with high/low temps (°F) and WMO weather code mapped
to emoji + description. Fetched in `src/fetchWeather.ts`.

---

## 8. Google Calendar Integration

- Package: `googleapis`
- Auth: service account JSON key stored at `./nepa-digest-e28c54d4aa7b.json`
  (gitignored via `nepa-digest-*.json` — **never commit this file**)
- `GOOGLE_SERVICE_ACCOUNT_KEY` in `.env` must be the **file path**:
  `GOOGLE_SERVICE_ACCOUNT_KEY=./nepa-digest-e28c54d4aa7b.json`
  The code also accepts inline JSON (legacy), but the file path is preferred.
  **Do not paste the JSON blob into `.env`** — it keeps getting reset by the
  IDE; use the file path instead.
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
  db.ts                — SQLite schema + ALTER TABLE migrations for new columns
  seed.ts              — DELETE + re-insert sources and family_members from JSON
  migrate.ts           — entry point: runs migrate() then seedFromFiles()
  logger.ts            — timestamped INFO/WARN/ERROR to console + logs/digest-YYYY-MM-DD.log
  fetchFeeds.ts        — fetch all active sources, normalize, dedupe, filter 7 days
  fetchWeather.ts      — 7-day forecast from Open-Meteo (no API key, Dallas PA)
  fetchCalendar.ts     — upcoming events from Google Calendar via service account
  fetchGrocery.ts      — TEST-ONLY grocery deals from Flipp/Wishabi circular feed (see §15)
  region.ts            — PURE regional rules: county→tier map, tier bonus, event window (§4a/§4b)
  net.ts               — withTimeout() hard deadline wrapper for every network call
  probeSources.ts      — npm run sources:probe — hits every source, reports item counts
  rankAndSummarize.ts  — keyword pre-filter → two Claude passes (events, news) + tier bonus
  emailTemplate.ts     — renders table-based HTML email (weather + calendar + national + events + news)
  sendDigest.ts        — orchestrates full pipeline; splits national vs local; export run(testMode)

  *.test.ts            — node:test unit tests (region, net, emailTemplate) — npm test
  scheduler.ts         — node-cron entry point; SCHEDULE constant controls frequency
```

Config files:
```
sources.json              — RSS feed definitions (edit here, then npm run db:migrate)
family.json               — audience profiles with email + additional_emails[]
ecosystem.config.js       — PM2 process config (node + ts-node/register on Windows)
tsconfig.json             — note "types": ["node"] is REQUIRED, see §12 gotcha
.env                      — secrets (never commit)
.env.example              — template for required env vars
nepa-digest-*.json        — Google service account key (gitignored, never commit)
grocery.json              — TEST-ONLY grocery deal config (items, store allowlist, zip)
data/digest.db            — SQLite database (gitignored)
logs/                     — daily log files digest-YYYY-MM-DD.log (gitignored)
```

---

## 11. Environment Variables

```
ANTHROPIC_API_KEY=              # Anthropic API key
RESEND_API_KEY=                 # Resend API key
FROM_EMAIL=hello@sromovski.com  # verified sender address
TEST_EMAIL=you@example.com      # recipient for --test mode (required for digest:test)
DB_PATH=./data/digest.db        # optional, defaults to ./data/digest.db

# Google Calendar (optional — omit both to skip calendar section)
GOOGLE_CALENDAR_ID=             # Google Calendar ID
GOOGLE_SERVICE_ACCOUNT_KEY=./nepa-digest-e28c54d4aa7b.json  # file path, not inline JSON
```

**GOTCHA — OS env vars shadow `.env`:** `dotenv` does NOT override a variable
that already exists in the process environment. If a key (e.g.
`ANTHROPIC_API_KEY`) is ALSO set as a Windows **User** environment variable,
that OS value wins and edits to `.env` are silently ignored — the symptom is a
persistent `401 authentication_error` no matter how many times you fix `.env`.
Check with PowerShell:
`[Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY','User')`.
Fix by updating/removing the OS var (User scope), then restart PM2 from a fresh
shell with `--update-env`. Keep the key in ONE place to avoid drift.

---

## 12. NPM Scripts

```bash
npm start             # start scheduler (stays alive, fires per SCHEDULE in scheduler.ts)
npm run db:migrate    # apply schema + reseed sources and family_members from JSON
npm run fetch         # fetch + normalize feeds, print to console
npm run digest:test   # full pipeline → send to TEST_EMAIL only (no sent_log write)
npm run digest:send   # full pipeline → send to all members (writes sent_log)
npm run sources:probe # hit EVERY source (active or not), report item counts + dates
npm test              # node:test unit tests (region rules, timeouts, email render)
npm run typecheck     # tsc --noEmit
```

**GOTCHA — `"types": ["node"]` is load-bearing.** Without it, `tsc --noEmit`
passes but `ts-node` fails on *some* entry points with a misleading
`TS2591: Cannot find name 'require'` (it also mis-reports unrelated type
errors this way). If a script suddenly can't find `require`/`process`, run
`npm run typecheck` first — that gives the real error.

**GOTCHA — one-shot CLIs must `process.exit(0)`.** `withTimeout()` abandons a
stalled request but cannot cancel the underlying socket, which keeps Node's
event loop alive indefinitely. `sendDigest.ts` and `probeSources.ts` therefore
exit explicitly on success. The scheduler calls `run()` directly and is
unaffected. Do not remove those `.then(() => process.exit(0))` calls.

---

## 13. Process Management — PM2

The app runs under PM2 on a local Windows machine.

```bash
pm2 start ecosystem.config.js        # start the scheduler
pm2 status                           # check running status
pm2 logs nepa-digest                 # live log tail
pm2 restart nepa-digest --update-env # restart AND reload .env (ALWAYS use --update-env)
pm2 stop nepa-digest                 # stop
pm2 save                             # persist process list across reboots
# NOTE: `pm2 startup` does NOT support Windows. Reboot persistence is handled
# by a Task Scheduler task instead — see "Reboot persistence" below.
```

**Critical:** Always use `--update-env` when restarting after `.env` changes.
Plain `pm2 restart` preserves the old environment and changes won't take effect.

**GOTCHA — `--update-env` injects the CALLING SHELL's environment, and it
MERGES, never removes.** Two consequences, both bit us on 2026-09-11:

1. If the shell you run `pm2` from has `ANTHROPIC_API_KEY` set (an AI coding
   agent's shell, or any terminal where it was exported), PM2 copies that key
   into the process env. `dotenv` does NOT override an existing process var,
   so the scheduler silently runs on the WRONG key — same failure shape as the
   OS-env gotcha in §11, but sourced from PM2 rather than Windows.
2. Because `--update-env` only adds and overwrites, you **cannot** remove a bad
   variable by restarting again, even from a clean shell. The only fix is to
   delete and recreate the process:

```bash
pm2 delete nepa-digest
pm2 start ecosystem.config.js      # from a shell with no ANTHROPIC_API_KEY
pm2 save                           # re-persist, or a reboot restores the bad env
```

Verify the process env is clean — this should print nothing:

```bash
pm2 env 0 | grep '^ANTHROPIC_API_KEY:'
```

Absent is CORRECT: it means `dotenv` loads the key from `.env` at startup.

**GOTCHA — `ecosystem.config.js` must use `ts-node/register/transpile-only`.**
With plain `ts-node/register`, the scheduler type-checks the whole project at
require time and holds the resulting TypeScript Program in memory **for the
life of the process** — measured at **2014 MB vs 221 MB** on 2026-09-11. The
process is long-lived, so that memory is never reclaimed. Types are checked by
`npm run typecheck`; the scheduler does not need to re-check them at runtime.
Do not revert this.

**Reboot persistence.** `pm2 startup` is not supported on Windows. A Task
Scheduler task named **`pm2-resurrect`** runs `pm2 resurrect` at user logon
(30s delay) to restore the saved process list. Created 2026-08-24 after a
reboot on 2026-08-23 silently killed the scheduler and no digest was sent.

```powershell
Get-ScheduledTask -TaskName pm2-resurrect      # check it's registered
Start-ScheduledTask -TaskName pm2-resurrect    # test it manually
```

After changing which processes should run, re-run `pm2 save` — the task only
restores whatever was in `dump.pm2` at the last save.

**Watch for duplicate schedulers.** Every extra `npm start` or `pm2 start`
creates ANOTHER cron registration, and each one sends a full digest. On
2026-08-20..23 three instances were running and every recipient got three
copies daily. Verify with `pm2 status` (expect exactly one `nepa-digest`) and
by grepping the day's log — more than one `Digest run started` line per day
means duplicates:

```bash
grep -c "Digest run started" logs/digest-$(date +%F).log   # expect 1
```

`ecosystem.config.js` uses `interpreter: 'node'` with
`interpreter_args: '--require ts-node/register'` — required on Windows because
the `node_modules/.bin/ts-node` shim is a Unix shell script Node can't run.

---

## 14. Open Decisions

- [ ] Revert scheduler to Sunday 7 AM only (`0 7 * * 0`) after daily testing period
- [ ] Make `sent_log` per-member so Adults and Children track history independently
      (currently global — if Adults gets article X, Children won't see it next run)
- [ ] Verify and enable WNEP / Times Leader / Citizens' Voice native RSS feeds
- [ ] Re-enable Reuters or AP News if hosting moves to a machine without DNS
      restrictions. **Reuters is now `"active": false`** — confirmed dead
      (`ENOTFOUND feeds.reuters.com`) by `npm run sources:probe` on 2026-09-10.
      NPR is the only live national source.
- [ ] Retry the 403 event sources (DiscoverNEPA, Pocono Mountains, Visit NEPA)
      — see §4b. DiscoverNEPA would be the best event feed in the region.
- [ ] Regional widening (2026-09-10) tuning pass: after a few live runs, check
      whether tier 3 (Lehigh/Northampton, ~60 mi) earns its place or should be
      dropped, and whether MAX_EVENTS/MAX_NEWS (6 + 6) is the right length.
- [x] Reboot persistence — done 2026-08-24 via `pm2-resurrect` Task Scheduler task
- [x] Widen scope beyond Luzerne — done 2026-09-10. 50-mile radius, 3 tiers
      (§4a), real event calendars (§4b), events/news split into two ranked
      sections.
- [ ] Consider adding a `logs/` rotation policy (one file per day, no cleanup yet)
- [ ] Grocery deals section (§15) is TEST-ONLY — decide whether to promote it to
      live digests, and whether to per-member/per-audience the item list

---

## 15. Grocery Deals (TEST EMAIL ONLY)

Experimental section that surfaces weekly grocery sale prices for specific
items near ZIP **18612**. **Only rendered in `--test` runs** — live digests to
family members never include it (guarded by a `testMode` check in
`sendDigest.ts`).

- Source: Flipp / Wishabi public circular search
  (`https://backflipp.wishabi.com/flipp/items/search`). Same data the Flipp
  app uses; **unofficial and undocumented** — if it ever changes shape the whole
  section is caught and skipped, exactly like weather/calendar. Never blocks the
  digest.
- **No exact 30-mile radius is possible** — the item payload carries no
  per-store distance. "Nearby" is approximated by (a) ZIP-localized results and
  (b) a NEPA grocery-store allowlist in `grocery.json` (`stores`).
- Config lives in `grocery.json` (project root): `items` (search terms +
  display labels), `stores` (merchant allowlist, case-insensitive substring
  match), `maxPerItem`, `zip`. Edit and re-run — **no DB migration needed**
  (read via static JSON import, unlike the `sources`/`family` DB seed pattern).
- Only deals valid on the run date are shown, sorted cheapest-first. Renders as
  a teal card between National Headlines and local news.
- Code: `src/fetchGrocery.ts` (fetch + filter), `grocerySection()` in
  `src/emailTemplate.ts` (render).
