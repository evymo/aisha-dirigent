#!/usr/bin/env node
/**
 * scripts/seed-ragnarok.mjs — Seed Ragnarok KB from Supabase knowledge data
 *
 * Fetches all published expert_rules and active knowledge_items + chunks,
 * builds markdown documents, and uploads them to Ragnarok via edge function.
 *
 * Usage:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/seed-ragnarok.mjs
 *
 * Options:
 *   --dry-run    List documents without uploading
 *   --project    Project ID (default: evymo)
 */
import { pg, AISHA_POSTGREST_URL, SERVICE_KEY } from './lib/remote-api.mjs';

const PROJECT = process.argv.includes('--project')
  ? process.argv[process.argv.indexOf('--project') + 1]
  : 'evymo';
const DRY_RUN = process.argv.includes('--dry-run');

async function uploadDoc(doc) {
  const blob = new Blob([doc.markdown], { type: 'text/plain' });
  const formData = new FormData();
  formData.append('action', 'upload');
  formData.append('project_id', PROJECT);
  formData.append('kb_id', doc.id);
  formData.append('source_type', 'txt');
  formData.append('language', 'en-US');
  formData.append('file', blob, `${doc.slug}.md`);

  const res = await fetch(`${AISHA_POSTGREST_URL}/functions/v1/ragnarok-upload`, {
      signal: AbortSignal.timeout(60000),
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
    body: formData,
  });
  return { status: res.status, ok: res.ok };
}

async function main() {
  console.log(`🔍 Seeding Ragnarok KB — project: ${PROJECT}${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

  // Fetch expert rules
  const rules = await pg(`
    SELECT slug, title, summary, category, body_markdown, ai_instructions, ai_context_tags
    FROM expert_rules WHERE status = 'published' ORDER BY title
  `);

  // Fetch knowledge items
  const items = await pg(`
    SELECT source_slug, title, summary, category, ai_instructions, ai_context_tags
    FROM knowledge_items WHERE status = 'active' ORDER BY title
  `);

  // Fetch chunks
  const chunks = await pg(`
    SELECT kc.chunk_text, kc.chunk_index, ki.source_slug
    FROM knowledge_chunks kc
    JOIN knowledge_items ki ON ki.id = kc.knowledge_item_id
    WHERE ki.status = 'active'
    ORDER BY ki.source_slug, kc.chunk_index
  `);

  // Build documents from rules
  const documents = [];
  for (const rule of rules) {
    let md = `# ${rule.title}\n\n`;
    md += `**Category:** ${rule.category}\n`;
    md += `**Tags:** ${(rule.ai_context_tags || []).join(', ')}\n\n`;
    if (rule.summary) md += `## Summary\n${rule.summary}\n\n`;
    if (rule.body_markdown) md += `## Content\n${rule.body_markdown}\n\n`;
    if (rule.ai_instructions) md += `## AI Instructions\n${rule.ai_instructions}\n\n`;
    documents.push({ id: `rule-${rule.slug}`, slug: rule.slug, title: rule.title, markdown: md });
  }

  // Build documents from knowledge items + chunks
  const chunksByItem = {};
  for (const c of chunks) {
    if (!chunksByItem[c.source_slug]) chunksByItem[c.source_slug] = [];
    chunksByItem[c.source_slug].push(c);
  }

  for (const item of items) {
    const ic = chunksByItem[item.source_slug] || [];
    let md = `# ${item.title}\n\n`;
    md += `**Category:** ${item.category || 'general'}\n`;
    md += `**Tags:** ${(item.ai_context_tags || []).join(', ')}\n\n`;
    if (item.summary) md += `## Summary\n${item.summary}\n\n`;
    if (item.ai_instructions) md += `## AI Instructions\n${item.ai_instructions}\n\n`;
    if (ic.length > 0) {
      md += `## Content\n`;
      for (const c of ic) md += `${c.chunk_text}\n\n`;
    }
    documents.push({ id: `ki-${item.source_slug}`, slug: item.source_slug, title: item.title, markdown: md });
  }

  console.log(`📄 ${documents.length} documents (${rules.length} rules + ${items.length} KB items)\n`);

  if (DRY_RUN) {
    for (const d of documents) console.log(`  ${d.id}: ${d.title} (${d.markdown.length} chars)`);
    console.log('\n(dry run — no uploads)');
    return;
  }

  // Upload in batches of 5
  let ok = 0, fail = 0;
  for (let i = 0; i < documents.length; i += 5) {
    const batch = documents.slice(i, i + 5);
    const results = await Promise.all(batch.map(d => uploadDoc(d)));
    for (let j = 0; j < results.length; j++) {
      if (results[j].ok) {
        ok++;
      } else {
        fail++;
        console.log(`  FAIL [${results[j].status}]: ${batch[j].id} (${batch[j].title})`);
      }
    }
    process.stdout.write(`  [${i + batch.length}/${documents.length}] ok=${ok} fail=${fail}\r`);
  }

  console.log(`\n\n✅ Done: ${ok} uploaded, ${fail} failed`);

  // Verify
  const listRes = await fetch(`${AISHA_POSTGREST_URL}/functions/v1/ragnarok-upload`, {
      signal: AbortSignal.timeout(60000),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
    body: JSON.stringify({ action: 'list', project_id: PROJECT }),
  });
  if (listRes.ok) {
    const body = await listRes.json().catch((_parseErr) => ({}));
    if (Array.isArray(body?.data)) {
      console.log(`📦 KBs in Ragnarok: ${body.data.length}`);
    }
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
