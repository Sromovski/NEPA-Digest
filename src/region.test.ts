import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTierBonus,
  tierFor,
  isEventInWindow,
  compareByStartDate,
  countyLabel,
  EVENT_WINDOW_DAYS,
} from './region';

test('tierFor maps known counties to their tier', () => {
  assert.equal(tierFor('Luzerne'), 1);
  assert.equal(tierFor('Lackawanna'), 2);
  assert.equal(tierFor('Monroe'), 2);
  assert.equal(tierFor('Lehigh'), 3);
  assert.equal(tierFor('Pike'), 3);
});

test('tierFor is case- and whitespace-insensitive', () => {
  assert.equal(tierFor('  luzerne  '), 1);
  assert.equal(tierFor('LACKAWANNA'), 2);
});

test('tierFor defaults unknown or missing counties to tier 2', () => {
  assert.equal(tierFor(undefined), 2);
  assert.equal(tierFor(''), 2);
  assert.equal(tierFor('Philadelphia'), 2);
});

test('applyTierBonus favors Luzerne, penalizes the outer ring', () => {
  assert.equal(applyTierBonus(7, 1), 8.5);
  assert.equal(applyTierBonus(7, 2), 7);
  assert.equal(applyTierBonus(7, 3), 6);
});

test('applyTierBonus clamps to the 0-10 scale', () => {
  assert.equal(applyTierBonus(10, 1), 10);
  assert.equal(applyTierBonus(0.5, 3), 0);
});

test('applyTierBonus treats an unknown tier as tier 2', () => {
  assert.equal(applyTierBonus(7, 99), 7);
  assert.equal(applyTierBonus(7, 0), 7);
});

test('applyTierBonus can lift a tier-1 item over a higher-scored tier-3 item', () => {
  // A 6/10 Wilkes-Barre story should outrank a 7/10 Allentown story.
  assert.ok(applyTierBonus(6, 1) > applyTierBonus(7, 3));
});

test('isEventInWindow includes an event starting earlier today', () => {
  const now = new Date('2026-09-10T19:00:00Z');
  const earlierToday = new Date('2026-09-10T13:00:00Z');
  assert.equal(isEventInWindow(earlierToday, now), true);
});

test('isEventInWindow excludes an event that already finished yesterday', () => {
  const now = new Date('2026-09-10T19:00:00Z');
  const yesterday = new Date('2026-09-09T13:00:00Z');
  assert.equal(isEventInWindow(yesterday, now), false);
});

test('isEventInWindow includes an event inside the look-ahead', () => {
  const now = new Date('2026-09-10T12:00:00Z');
  const soon = new Date('2026-09-20T12:00:00Z');
  assert.equal(isEventInWindow(soon, now), true);
});

test('isEventInWindow excludes an event beyond the look-ahead', () => {
  const now = new Date('2026-09-10T12:00:00Z');
  const farOff = new Date('2026-12-25T12:00:00Z');
  assert.equal(isEventInWindow(farOff, now), false);
});

test('isEventInWindow includes an event exactly at the look-ahead boundary', () => {
  const now = new Date('2026-09-10T12:00:00Z');
  const boundary = new Date(now.getTime() + EVENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  assert.equal(isEventInWindow(boundary, now), true);
});

test('isEventInWindow rejects an invalid date', () => {
  const now = new Date('2026-09-10T12:00:00Z');
  assert.equal(isEventInWindow(new Date('not a date'), now), false);
});

test('compareByStartDate orders events soonest-first', () => {
  const events = [
    { pubDate: new Date('2026-09-20T12:00:00Z') },
    { pubDate: new Date('2026-09-12T12:00:00Z') },
    { pubDate: new Date('2026-09-15T12:00:00Z') },
  ];
  const sorted = [...events].sort(compareByStartDate);
  assert.deepEqual(
    sorted.map(e => e.pubDate.toISOString().slice(0, 10)),
    ['2026-09-12', '2026-09-15', '2026-09-20']
  );
});

test('countyLabel hides Luzerne and shows everywhere else', () => {
  assert.equal(countyLabel('Luzerne'), '');
  assert.equal(countyLabel('Lackawanna'), 'Lackawanna County');
  assert.equal(countyLabel(undefined), '');
});
