import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

function getDb(): Database.Database {
  const dbPath = process.env.DB_PATH ?? './data/digest.db';
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return new Database(dbPath);
}

export function migrate(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS family_members (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT    NOT NULL,
      email           TEXT    NOT NULL UNIQUE,
      alternate_email TEXT,
      interests       TEXT    NOT NULL DEFAULT '[]',
      active          INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );


    CREATE TABLE IF NOT EXISTS sources (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      url        TEXT    NOT NULL,
      type       TEXT    NOT NULL DEFAULT 'rss',
      category   TEXT    NOT NULL DEFAULT 'news',
      active     INTEGER NOT NULL DEFAULT 1,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sent_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      url_hash    TEXT    NOT NULL,
      article_url TEXT    NOT NULL,
      title       TEXT    NOT NULL,
      source_name TEXT    NOT NULL,
      sent_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_sent_log_url_hash ON sent_log(url_hash);
    CREATE INDEX IF NOT EXISTS idx_sent_log_sent_at ON sent_log(sent_at);
  `);

  // Add columns introduced after initial schema (safe to re-run)
  try { db.exec(`ALTER TABLE family_members ADD COLUMN alternate_email TEXT`); } catch {}

  db.close();
  console.log('Migration complete.');
}

export function openDb(): Database.Database {
  return getDb();
}
