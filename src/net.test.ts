import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout } from './net';

test('withTimeout resolves when the promise wins', async () => {
  const result = await withTimeout(Promise.resolve('ok'), 1000, 'fast');
  assert.equal(result, 'ok');
});

test('withTimeout rejects when the deadline passes first', async () => {
  const never = new Promise<string>(() => {});
  await assert.rejects(
    () => withTimeout(never, 20, 'stuck feed'),
    /timed out after 20ms: stuck feed/
  );
});

test('withTimeout propagates the original rejection', async () => {
  await assert.rejects(
    () => withTimeout(Promise.reject(new Error('ENOTFOUND')), 1000, 'dead host'),
    /ENOTFOUND/
  );
});

test('withTimeout does not keep the process alive after resolving', async () => {
  // If the timer were left dangling, an unref-less setTimeout would hold the
  // event loop open for the full duration.
  const before = Date.now();
  await withTimeout(Promise.resolve(1), 60_000, 'long deadline');
  assert.ok(Date.now() - before < 1000);
});
