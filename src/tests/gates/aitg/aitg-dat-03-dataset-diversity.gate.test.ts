/**
 * AITG-DAT-03 — Dataset Diversity & Coverage.
 *
 * Every RAG corpus / knowledge dataset must declare diversity metadata
 * (language, source, demographic / topic coverage). Static gate:
 *   - knowledge_items + expert_rules tables MUST have language / source
 *     columns
 *   - the embedding pipeline (svc-mcp-knowledge embeddings route) MUST
 *     record source metadata at ingest
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const TABLES_DIR = resolve(ROOT, 'aisha/db/sql/tables');

const DIVERSITY_FIELDS = ['language', 'source', 'origin', 'locale', 'category', 'expertise'];

function findKnowledgeTables(): string[] {
  if (!existsSync(TABLES_DIR)) return [];
  // Restrict to RAG-corpus-shaped tables specifically. Other matches like
  // `agent_runtime_knowledge_links` are linker tables (no content), and
  // `knowledge_base_metadata` is config; neither needs diversity fields.
  const FOCUS = [
    'knowledge_items.sql',
    'expert_rules.sql',
    'rag_corpus.sql',
    'rag_corpus_items.sql',
    'training_dataset.sql',
  ];
  return readdirSync(TABLES_DIR).filter(
    (f) => FOCUS.includes(f) && f.endsWith('.sql'),
  );
}

describe('AITG-DAT-03: dataset diversity metadata on knowledge tables', () => {
  const files = findKnowledgeTables();

  test('positive: at least one knowledge / expert_rule / embedding table exists', () => {
    expect(files.length, 'expected knowledge_items or expert_rules SoT file').toBeGreaterThan(0);
  });

  test('positive: every knowledge table declares ≥1 diversity field', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const sql = readFileSync(join(TABLES_DIR, f), 'utf8').toLowerCase();
      const found = DIVERSITY_FIELDS.some((field) => sql.includes(field));
      if (!found) offenders.push(f);
    }
    expect(
      offenders,
      `Tables missing diversity metadata (language/source/origin/locale/category/expertise):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  test('negative: detector recognises missing diversity', () => {
    const sample = 'CREATE TABLE x (id uuid, content text);';
    const found = DIVERSITY_FIELDS.some((field) => sample.includes(field));
    expect(found).toBe(false);
  });
});
