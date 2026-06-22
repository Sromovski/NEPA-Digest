import fs from 'fs';
import path from 'path';

const LOG_DIR = './logs';
let logDirReady = false;

function ensureLogDir(): void {
  if (logDirReady) return;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  logDirReady = true;
}

function logLine(level: string, message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}`;
  console.log(line);

  try {
    ensureLogDir();
    const date = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(path.join(LOG_DIR, `digest-${date}.log`), line + '\n');
  } catch {
    // log file write failure should never crash the app
  }
}

export const log   = (msg: string) => logLine('INFO ', msg);
export const warn  = (msg: string) => logLine('WARN ', msg);
export const error = (msg: string) => logLine('ERROR', msg);
