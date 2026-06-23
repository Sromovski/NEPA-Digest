import { openDb } from './db';
import sources from '../sources.json';
import family from '../family.json';

export function seedFromFiles(): void {
  const db = openDb();

  const insertSource = db.prepare(`
    INSERT INTO sources (name, url, type, category, active)
    VALUES (@name, @url, @type, @category, @active)
  `);

  const insertMember = db.prepare(`
    INSERT INTO family_members (name, email, alternate_email, interests)
    VALUES (@name, @email, @alternate_email, @interests)
  `);

  // Single transaction — sources and members reset atomically
  const seedAll = db.transaction(() => {
    db.prepare('DELETE FROM sources').run();
    let sourceCount = 0;
    for (const s of sources) {
      if (!s.url) continue;
      insertSource.run({
        name: s.name,
        url: s.url,
        type: s.type,
        category: s.category,
        active: s.active ? 1 : 0,
      });
      sourceCount++;
    }

    db.prepare('DELETE FROM family_members').run();
    let memberCount = 0;
    for (const m of family.members) {
      insertMember.run({
        name: m.name,
        email: m.email,
        alternate_email: (m as any).alternate_email ?? null,
        interests: JSON.stringify(m.interests),
      });
      memberCount++;
    }

    console.log(`Seeded ${sourceCount} source(s), ${memberCount} member(s).`);
  });

  seedAll();
  db.close();
}
