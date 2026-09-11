import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDigestEmail } from './emailTemplate';
import type { Article, FamilyMember } from './types';
import type { RankedArticle } from './rankAndSummarize';

const member: FamilyMember = {
  id: 1,
  name: 'Adults',
  email: 'a@example.com',
  additional_emails: [],
  interests: ['farmers markets', 'festivals'],
};

function ranked(over: Partial<Article> & { title: string }): RankedArticle {
  return {
    article: {
      summary: 'raw feed text',
      link: 'https://example.com/story',
      source: 'Test Source',
      pubDate: new Date('2026-09-10T12:00:00Z'),
      category: 'events',
      urlHash: 'abc123',
      tier: 1,
      ...over,
    } as Article,
    summary: 'An original-words summary.',
    matchReason: 'matches festivals',
    score: 8,
    rawScore: 7,
  };
}

test('renders both local sections when each has items', () => {
  const html = renderDigestEmail(
    member,
    [ranked({ title: 'Fall Farmers Market' })],
    [ranked({ title: 'Council approves budget', category: 'news' })],
    [],
    'September 4 – September 10, 2026'
  );

  assert.match(html, /Events &amp; Things To Do/);
  assert.match(html, /Around the Region/);
  assert.match(html, /Fall Farmers Market/);
  assert.match(html, /Council approves budget/);
});

test('omits a section heading when that section is empty', () => {
  const html = renderDigestEmail(
    member,
    [],
    [ranked({ title: 'Council approves budget', category: 'news' })],
    [],
    'range'
  );

  assert.doesNotMatch(html, /Events &amp; Things To Do/);
  assert.match(html, /Around the Region/);
});

test('shows the empty-state message only when both sections are empty', () => {
  const empty = renderDigestEmail(member, [], [], [], 'range');
  assert.match(empty, /No new articles matched your interests/);

  const notEmpty = renderDigestEmail(member, [ranked({ title: 'X' })], [], [], 'range');
  assert.doesNotMatch(notEmpty, /No new articles matched your interests/);
});

test('labels out-of-county items and leaves Luzerne items unlabeled', () => {
  const away = renderDigestEmail(
    member,
    [ranked({ title: 'Scranton festival', county: 'Lackawanna', tier: 2 })],
    [],
    [],
    'range'
  );
  assert.match(away, /Lackawanna County/);

  const home = renderDigestEmail(
    member,
    [ranked({ title: 'Wilkes-Barre festival', county: 'Luzerne', tier: 1 })],
    [],
    [],
    'range'
  );
  assert.doesNotMatch(home, /Luzerne County<\/span>/);
});

test('shows a start-date chip for dated calendar events only', () => {
  const dated = renderDigestEmail(
    member,
    [ranked({ title: 'Pokemon Day', eventDate: new Date('2026-09-12T14:00:00') })],
    [],
    [],
    'range'
  );
  assert.match(dated, /Sat, Sep 12/);

  const undated = renderDigestEmail(member, [ranked({ title: 'Some event' })], [], [], 'range');
  assert.doesNotMatch(undated, /&#128197; /);
});

test('escapes HTML in titles and summaries', () => {
  const html = renderDigestEmail(
    member,
    [ranked({ title: '<script>alert(1)</script>' })],
    [],
    [],
    'range'
  );
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('neutralizes a non-http link', () => {
  const html = renderDigestEmail(
    member,
    [ranked({ title: 'Bad link', link: 'javascript:alert(1)' })],
    [],
    [],
    'range'
  );
  assert.doesNotMatch(html, /href="javascript:/);
});
