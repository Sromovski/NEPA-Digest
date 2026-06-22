import 'dotenv/config';
import cron from 'node-cron';
import { run } from './sendDigest';
import { log, error } from './logger';

// Every Sunday at 7:00 AM Eastern
const SCHEDULE = '0 7 * * 0';
const TIMEZONE = 'America/New_York';

async function runDigest(): Promise<void> {
  try {
    await run(false);
  } catch (err) {
    error(`Unhandled error in digest run: ${(err as Error).message}`);
  }
}

cron.schedule(SCHEDULE, runDigest, { timezone: TIMEZONE });

log(`Scheduler started — digest runs every Sunday at 7:00 AM Eastern (${SCHEDULE}).`);
log('Process will stay alive. Press Ctrl+C to stop.');
