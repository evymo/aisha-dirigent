/**
 * Gate: the knowledge_items seed must not duplicate a chat-delegation source_slug.
 *
 * chat-delegation-playbook / chat-delegation-architecture were each seeded 17x. Root
 * cause: they are source_type='manual' with source_id=NULL, so the only unique index
 * on knowledge_items (idx_knowledge_items_source_unique, WHERE source_type='guild_db')
 * never applied, and ON CONFLICT (id) with 17 distinct hardcoded ids could not dedup.
 * Effect: a chat KB query returned the same playbook up to 17x in a top-10 window,
 * crowding out other knowledge and degrading retrieval precision.
 *
 * This gate locks the SoT seed to exactly one canonical block per chat-delegation slug
 * so it can never silently re-duplicate. Structural prevention for ALL ingestion paths
 * (a partial UNIQUE (source_slug, locale) index — which must allow Brick4 locale
 * variants) is tracked as a separate finalization task.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SEED = fs.readFileSync(
  path.join(process.cwd(), 'aisha/db/seed/core/21_aisha_knowledge.sql'),
  'utf8',
);
const blockCount = (slug: string): number =>
  (SEED.match(new RegExp(`'${slug}'`, 'g')) ?? []).length;

describe('knowledge seed — chat-delegation is deduped to one canonical item', () => {
  it('seeds exactly one chat-delegation-playbook block (was 17 — duplicate noise)', () => {
    expect(blockCount('chat-delegation-playbook')).toBe(1);
  });

  it('seeds exactly one chat-delegation-architecture block (was 17 — duplicate noise)', () => {
    expect(blockCount('chat-delegation-architecture')).toBe(1);
  });

  it('the seed has balanced INSERT / ON CONFLICT blocks (no truncated edit)', () => {
    const inserts = (SEED.match(/INSERT INTO public\.knowledge_items \(/g) ?? []).length;
    const conflicts = (SEED.match(/ON CONFLICT/g) ?? []).length;
    expect(inserts).toBeGreaterThan(0);
    expect(conflicts).toBe(inserts);
  });
});
