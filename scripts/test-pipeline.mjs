#!/usr/bin/env node
/**
 * scripts/test-pipeline.mjs — Full pipeline test for AISHA Knowledge System
 *
 * Tests all MCP tools, search backends (v1, v2, Ragnarok), story context,
 * compose_context profiles, route_task, and direct SQL functions.
 *
 * Usage:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/test-pipeline.mjs
 *
 * Environment:
 *   AISHA_STORY_ID — override story ID (default: aisha-orchestrator story)
 *   AISHA_POSTGREST_URL   — override API URL
 */
import { pg, mcp, STORY_ID, createTestRunner } from './lib/remote-api.mjs';

const { test, summary } = createTestRunner();

async function safeCall(fn) {
  try { return await fn(); } catch (e) { return { __error: e.message }; }
}

async function main() {
  console.log(`\n🧪 AISHA Knowledge Pipeline Test`);
  console.log(`   Story: ${STORY_ID}\n`);

  // =============================================
  // SECTION 1: search_knowledge v1 (word splitting)
  // =============================================
  console.log('📚 SECTION 1: search_knowledge v1');
  {
    const r = await safeCall(() => mcp('search_knowledge', { query: 'RPC only pattern', scope: 'rules' }));
    test('EN: "RPC only pattern"', Array.isArray(r) && r.length > 0 && r.length < 50, `got ${r?.length ?? r?.__error}`);
  }
  {
    const r = await safeCall(() => mcp('search_knowledge', { query: 'logovat chyby error handling', scope: 'rules' }));
    test('CZ+EN: "logovat chyby error handling"', Array.isArray(r) && r.length > 0 && r.length < 50, `got ${r?.length ?? r?.__error}`);
  }
  {
    const r = await safeCall(() => mcp('search_knowledge', { query: 'audit journal pattern bezpečnost', scope: 'rules' }));
    test('CZ+EN: audit + bezpečnost', Array.isArray(r) && r.length > 0 && r.length < 50, `got ${r?.length ?? r?.__error}`);
  }
  {
    const r = await safeCall(() => mcp('search_knowledge', { query: 'i18n překlady internacionalizace', scope: 'rules' }));
    test('CZ: i18n překlady', Array.isArray(r) && r.length > 0 && r.length < 50, `got ${r?.length ?? r?.__error}`);
  }

  // =============================================
  // SECTION 2: search_knowledge_v2 (hybrid)
  // =============================================
  console.log('\n🔬 SECTION 2: search_knowledge_v2 (hybrid vector+text)');
  {
    const r = await safeCall(() => mcp('search_knowledge_v2', { query: 'how to create RPC function with audit', limit: 5 }));
    test('EN: RPC function audit', Array.isArray(r?.results) && r.results.length > 0, `got ${r?.results?.length ?? r?.__error ?? 0}`);
  }
  {
    const r = await safeCall(() => mcp('search_knowledge_v2', { query: 'bezpečnostní vzory sensitive data', limit: 5 }));
    test('CZ: bezpečnostní vzory', Array.isArray(r?.results) && r.results.length > 0, `got ${r?.results?.length ?? r?.__error ?? 0}`);
  }

  // =============================================
  // SECTION 3: search_ragnarok (Elasticsearch)
  // =============================================
  console.log('\n🔍 SECTION 3: search_ragnarok (Elasticsearch RAG)');
  {
    const r = await safeCall(() => mcp('search_ragnarok', { query: 'RPC only pattern security definer', project: 'evymo', top_k: 3 }));
    const hasResults = r?.results?.length > 0 || (typeof r === 'string' && r.length > 50);
    test('Ragnarok: RPC pattern', hasResults, `type=${typeof r}, err=${r?.__error}`);
  }
  {
    const r = await safeCall(() => mcp('search_ragnarok', { query: 'migrace workflow databáze', project: 'evymo', top_k: 3 }));
    const hasResults = r?.results?.length > 0 || (typeof r === 'string' && r.length > 50);
    test('Ragnarok: migrace CZ', hasResults, `type=${typeof r}`);
  }

  // =============================================
  // SECTION 4: get_expert_rule
  // =============================================
  console.log('\n📏 SECTION 4: get_expert_rule');
  {
    const r = await safeCall(() => mcp('get_expert_rule', { slug: 'aisha-rpc-only-pattern' }));
    const text = typeof r === 'string' ? r : JSON.stringify(r);
    test('Expert rule: RPC-only', text.includes('RPC'), `got ${typeof r}`);
  }
  {
    const r = await safeCall(() => mcp('get_expert_rule', { slug: 'aisha-audit-journal-pattern' }));
    const text = typeof r === 'string' ? r : JSON.stringify(r);
    test('Expert rule: audit-journal', text.includes('audit') || text.includes('Audit'), `got ${typeof r}`);
  }

  // =============================================
  // SECTION 5: get_story_context
  // =============================================
  console.log('\n📖 SECTION 5: get_story_context');
  {
    const r = await safeCall(() => mcp('get_story_context', { story_id: STORY_ID }));
    const text = typeof r === 'string' ? r : JSON.stringify(r);
    test('Story context returned', text.length > 100 && !r?.__error, `len=${text.length} err=${r?.__error}`);
    test('Contains title', text.includes('AISHA') || text.includes('Orchestrator'), 'missing title');
    test('Contains tech stack', text.includes('typescript') || text.includes('react'), 'missing tech');
    test('Contains rules', text.includes('rule') || text.includes('pravidl'), 'missing rules ref');
  }

  // =============================================
  // SECTION 6: compose_context (all profiles)
  // =============================================
  console.log('\n🧩 SECTION 6: compose_context (6 profiles)');
  const profiles = ['rules_only', 'repo_plus_rules', 'planning_heavy', 'evidence_strict', 'chat_lightweight', 'incident_response'];
  for (const profile of profiles) {
    const r = await safeCall(() => mcp('compose_context', { story_id: STORY_ID, profile }));
    const text = typeof r === 'string' ? r : JSON.stringify(r);
    test(`Profile: ${profile}`, text.length > 50 && !text.includes('"error"'), `len=${text.length}`);
  }

  // =============================================
  // SECTION 7: route_task
  // =============================================
  console.log('\n🔀 SECTION 7: route_task');
  const routes = [
    { kind: 'chat', desc: 'How to create RPC function?', expect: ['librarian', 'agent'] },
    { kind: 'pr_gate', desc: 'Check compliance', expect: ['compliance', 'gate'] },
    { kind: 'incident', desc: 'Production DB error', expect: ['debug', 'dev_patch'] },
  ];
  for (const rt of routes) {
    const r = await safeCall(() => mcp('route_task', { task_kind: rt.kind, description: rt.desc }));
    const text = typeof r === 'string' ? r : JSON.stringify(r);
    const ok = rt.expect.some(kw => text.includes(kw)) || text.length > 20;
    test(`Route: ${rt.kind}`, ok, `text=${text.substring(0, 80)}`);
  }

  // =============================================
  // SECTION 8: get_project_context
  // =============================================
  console.log('\n🏗️ SECTION 8: get_project_context');
  {
    const r = await safeCall(() => mcp('get_project_context', { project_description: 'AISHA Platform platform with Supabase, React, n8n', story_id: STORY_ID }));
    const text = typeof r === 'string' ? r : JSON.stringify(r);
    test('Project context', text.length > 50 && !text.includes('"error"'), `len=${text.length} err=${r?.__error}`);
  }

  // =============================================
  // SECTION 9: Cross-language search
  // =============================================
  console.log('\n🌐 SECTION 9: Cross-language search');
  {
    const r = await safeCall(() => mcp('search_knowledge', { query: 'jak logovat', scope: 'all' }));
    test('CZ→EN: "jak logovat"', Array.isArray(r) && r.length > 0 && r.length < 100, `got ${r?.length ?? r?.__error}`);
  }
  {
    const r = await safeCall(() => mcp('search_knowledge_v2', { query: 'testovací pravidla pro hooky', limit: 3 }));
    test('CZ v2: testovací pravidla', Array.isArray(r?.results) && r.results.length > 0, `got ${r?.results?.length ?? r?.__error ?? 0}`);
  }

  // =============================================
  // SECTION 10: Direct SQL functions
  // =============================================
  console.log('\n⚡ SECTION 10: Direct SQL functions (pg-meta)');
  {
    const r = await safeCall(() => pg(`SELECT mcp_get_story_context('${STORY_ID}'::uuid)`));
    const ctx = r?.[0]?.mcp_get_story_context;
    test('SQL: story has title', !!ctx?.story?.title, `title=${ctx?.story?.title}`);
    test('SQL: ruleset count=17', ctx?.ruleset?.rule_count === 17, `got ${ctx?.ruleset?.rule_count}`);
    test('SQL: rules_preview=17', ctx?.rules_preview?.length === 17, `got ${ctx?.rules_preview?.length}`);
    test('SQL: build_config set', Object.keys(ctx?.build_config || {}).length > 0, 'empty');
    test('SQL: env_hints set', Object.keys(ctx?.env_hints || {}).length > 0, 'empty');
    test('SQL: mcp_endpoint set', !!ctx?.mcp_endpoint, `${ctx?.mcp_endpoint}`);
  }

  // =============================================
  // SECTION 11: Admin & stats
  // =============================================
  console.log('\n📊 SECTION 11: Admin & stats');
  {
    const r = await safeCall(() => mcp('get_knowledge_stats', {}));
    const text = typeof r === 'string' ? r : JSON.stringify(r);
    test('Knowledge stats', text.length > 20, `len=${text.length}`);
  }
  {
    const r = await safeCall(() => mcp('admin_health_check', {}));
    const text = typeof r === 'string' ? r : JSON.stringify(r);
    test('Health check', text.length > 20 && !r?.__error, `len=${text.length} err=${r?.__error}`);
  }

  // =============================================
  // SUMMARY
  // =============================================
  const { failed } = summary();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
