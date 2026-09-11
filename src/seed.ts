import { openDb } from './db';
import { tierFor } from './region';
import sources from '../sources.json';
import family from '../family.json';

export function seedFromFiles(): void {
  const db = openDb();

  const insertSource = db.prepare(`
    INSERT INTO sources (name, url, type, category, active, tier, county)
    VALUES (@name, @url, @type, @category, @active, @tier, @county)
  `);

  const insertMember = db.prepare(`
    INSERT INTO family_members (name, email, additional_emails, interests)
    VALUES (@name, @email, @additional_emails, @interests)
  `);

  // Single transaction — sources and members reset atomically
  const seedAll = db.transaction(() => {
    db.prepare('DELETE FROM sources').run();
    let sourceCount = 0;
    for (const s of sources) {
      if (!s.url) continue;
      const county = (s as any).county as string | undefined;
      insertSource.run({
        name: s.name,
        url: s.url,
        type: s.type,
        category: s.category,
        active: s.active ? 1 : 0,
        // Fall back to the county map so a source can omit an explicit tier.
        tier: (s as any).tier ?? tierFor(county),
        county: county ?? null,
      });
      sourceCount++;
    }

    db.prepare('DELETE FROM family_members').run();
    let memberCount = 0;
    for (const m of family.members) {
      insertMember.run({
        name: m.name,
        email: m.email,
        additional_emails: JSON.stringify((m as any).additional_emails ?? []),
        interests: JSON.stringify(m.interests),
      });
      memberCount++;
    }

    console.log(`Seeded ${sourceCount} source(s), ${memberCount} member(s).`);
  });

  seedAll();
  db.close();
}
