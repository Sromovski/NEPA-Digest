# Code Review — Luzerne County Weekly Digest

Reviewed against all source files as of Phase 6 completion.
Findings are grouped by severity: **Bug**, **Security**, **Quality**, **Minor**.

---

## src/emailTemplate.ts

### [Security] Unescaped article content injected into HTML

`article.title`, `article.summary`, and `article.link` are interpolated
directly into the HTML template string without escaping.

```typescript
// articleRow() — line 36
<a href="${article.link}" ...>${article.title}</a>
// line 43
${summary}
```

**Risk:** A malformed feed item whose title or summary contains `<`, `>`, or
`"` characters that survived `stripHtml` (e.g. Claude-generated summaries are
never passed through `stripHtml`) could break the email HTML structure. A
crafted `article.link` containing `javascript:` or a `"` could inject
attributes.

**Fix:** Add a small HTML-escape helper and apply it to all interpolated
values:

```typescript
function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

Apply `escHtml()` to `article.title`, `summary`, and use it to validate
`article.link` (allow only `http:` / `https:` schemes).

---

## src/sendDigest.ts

### [Bug] Empty TEST_EMAIL silently produces a Resend validation error

```typescript
const TEST_EMAIL = process.env.TEST_EMAIL ?? '';
```

If `TEST_EMAIL` is not set in `.env`, `run(true)` will attempt to send to
`''` and fail with a Resend 422. The error is caught and logged per-member,
so the run exits cleanly but sends nothing — which looks like success from the
logs.

**Fix:** Validate required env vars at startup and fail fast with a clear
message:

```typescript
function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}
```

Call this at the top of `run()` (or module load) for `RESEND_API_KEY`,
`FROM_EMAIL`, and `TEST_EMAIL` (in test mode only).

### [Quality] Module-level Resend instantiation

```typescript
const resend = new Resend(process.env.RESEND_API_KEY);
```

This runs when the module is first imported, before dotenv has necessarily
loaded. It also means a missing key produces a confusing error deep in the
Resend SDK rather than a clear startup message.

**Fix:** Instantiate inside `run()` or after validating the env var.

### [Quality] Duplicate articles across digests written to sent_log

If the same article appears in both the Adults and Children digests,
`allSent` contains it twice. `INSERT OR IGNORE` handles this correctly, but
the array is noisier than needed. Deduping `allSent` by `urlHash` before
logging is a small cleanup.

---

## src/rankAndSummarize.ts

### [Bug] console.log used instead of logger

`buildDigests` uses `console.log` for progress output while `sendDigest.ts`
uses the structured logger. Progress lines from `buildDigests` go to the
console but not to the daily log file.

```typescript
// lines 118, 123-125, 129
console.log(`Ranking articles for ${members.length} family member(s)...`);
console.log(`  [${member.name}] interests: ...`);
```

**Fix:** Replace `console.log` calls in `buildDigests` with `log()` from
`./logger`.

### [Quality] No retry on Claude API failures

If the Claude API returns a 529 (overloaded) or transient 500, the member's
digest silently becomes empty and the error is logged as a warning. For a
weekly send this is a meaningful failure — the user gets a blank digest with
no indication in the email.

**Fix:** Add a simple retry (2 attempts, 3s delay) inside `rankForMember`,
and consider sending the email with a "ranking unavailable this week" message
rather than an empty digest.

### [Quality] No validation of Claude's JSON response shape

```typescript
const results: { index: number; score: number; ... }[] = JSON.parse(jsonMatch[0]);
```

The cast is unchecked. If Claude returns a JSON array but with unexpected
field names or types (e.g., `score` as a string `"7"` instead of `7`), the
`r.score >= MIN_SCORE` filter silently drops everything.

**Fix:** Add a type guard or coerce `score` to a number: `Number(r.score)`.

---

## src/fetchFeeds.ts

### [Quality] No timeout on RSS fetch requests

`rss-parser` uses the default Node.js `http` timeout — effectively unlimited.
A slow or hanging upstream feed will hold up `Promise.allSettled` for all
other sources.

**Fix:** Configure a timeout on the parser:

```typescript
const parser = new RSSParser({ timeout: 10000 }); // 10s
```

### [Quality] Undated articles pass the 7-day filter as "now"

```typescript
const pub = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
return pub >= cutoff;
```

Items missing `pubDate` are treated as published right now and always pass.
Most legitimate feeds include dates; undated items are often stale. Consider
dropping them (`return false` when `!item.pubDate`) or at least tracking it
in the summary log.

### [Minor] fetchSource uses console.error, not the logger

```typescript
console.error(`[WARN] Failed to fetch "${source.name}": ...`);
```

This predates `logger.ts`. Should use `warn()` from `./logger` for
consistency.

---

## src/seed.ts

### [Quality] Two separate transactions for sources and members

```typescript
seedSources(); // DELETE FROM sources + re-insert
seedMembers(); // DELETE FROM family_members + re-insert
```

If the process crashes between the two calls, sources are cleared but members
still hold old data. While this would be fixed on the next `db:migrate` run,
it leaves the DB in a temporarily inconsistent state.

**Fix:** Wrap both operations in a single transaction.

---

## src/db.ts

### [Minor] DB_PATH read at module load time

```typescript
const DB_PATH = process.env.DB_PATH ?? './data/digest.db';
```

This is evaluated when `db.ts` is first imported. All entry points import
`dotenv/config` before importing `db.ts`, so in practice this works. But it
relies on import ordering — if that ever changes, the env var won't be
applied.

**Fix:** Move the constant inside `getDb()` so it reads the env var at call
time.

---

## src/logger.ts

### [Minor] Directory existence check on every log call

```typescript
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
```

This stat call runs on every single log line. At a few dozen log lines per
run it's negligible, but it's easy to cache:

```typescript
let logDirReady = false;
function ensureLogDir(): void {
  if (logDirReady) return;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  logDirReady = true;
}
```

---

## src/scheduler.ts

### [Minor] No protection against overlapping runs

node-cron fires the callback on schedule regardless of whether the previous
run is still in progress. For a weekly digest that takes ~90s, the next
trigger is 7 days away, so overlap is not a real concern. Worth knowing if
the schedule is ever shortened.

---

## src/types.ts

### [Minor] Source.active typed as number, not boolean

```typescript
active: number;
```

SQLite stores booleans as integers. Callers must remember that `active === 1`
means true. Mapping to `boolean` when loading from the DB (in `fetchFeeds.ts`
the query already filters `WHERE active = 1`, so it never surfaces) or
changing the type to `boolean` with a cast at load time would be cleaner.

---

## Summary

| File | Severity | Finding |
|---|---|---|
| emailTemplate.ts | Security | Unescaped HTML/link injection in email body |
| sendDigest.ts | Bug | Empty TEST_EMAIL fails silently, looks like success |
| sendDigest.ts | Quality | Module-level Resend instantiation before env loaded |
| rankAndSummarize.ts | Bug | console.log bypasses logger / log file |
| rankAndSummarize.ts | Quality | No retry on Claude API transient failures |
| rankAndSummarize.ts | Quality | Claude JSON response shape not validated |
| fetchFeeds.ts | Quality | No timeout on RSS fetch requests |
| fetchFeeds.ts | Quality | Undated articles pass 7-day filter silently |
| fetchFeeds.ts | Minor | console.error predates logger, should use warn() |
| seed.ts | Quality | Two separate transactions — inconsistent crash state |
| db.ts | Minor | DB_PATH read at import time, sensitive to import order |
| logger.ts | Minor | fs.existsSync on every log call |
| scheduler.ts | Minor | No overlap guard (not a real risk at weekly cadence) |
| types.ts | Minor | Source.active typed as number instead of boolean |

**Highest priority to fix before going live:**
1. HTML escaping in `emailTemplate.ts` (Security)
2. `TEST_EMAIL` startup validation in `sendDigest.ts` (Bug)
3. RSS fetch timeout in `fetchFeeds.ts` (Quality — prevents hangs)
4. Use logger consistently in `rankAndSummarize.ts` (Bug — missing log file entries)
