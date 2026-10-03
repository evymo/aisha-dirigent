#!/usr/bin/env node
/**
 * AISHA Webhook Health Check
 *
 * Tests all n8n webhook endpoints to verify they're registered and responding.
 * Use after Coolify restart or webhook configuration changes.
 *
 * @example
 *   npm run aisha:webhooks:test
 *   N8N_WEBHOOK_URL=https://n8n.example.com npm run aisha:webhooks:test
 */

if (!process.env.N8N_WEBHOOK_URL) {
  console.error("ERROR: N8N_WEBHOOK_URL not set (env-driven; no hardcoded host).");
  process.exit(1);
}
const N8N_URL = process.env.N8N_WEBHOOK_URL.replace(/\/$/, "");
const API_KEY = process.env.N8N_API_KEY || "";

const ENDPOINTS = [
  { name: "Dirigent Agent",    path: "/webhook/dirigent-agent",       method: "POST" },
  { name: "Knowledge Agent",   path: "/webhook/knowledge-agent",      method: "POST" },
  { name: "Compliance Agent",  path: "/webhook/compliance-agent",     method: "POST" },
  { name: "Delivery Agent",    path: "/webhook/delivery-agent",       method: "POST" },
  { name: "Model Router",      path: "/webhook/model-router",         method: "POST" },
  { name: "PR Gate",           path: "/webhook/pr-compliance-gate",   method: "POST" },
  { name: "Compliance Reroute",path: "/webhook/compliance-reroute",   method: "POST" },
];

// Workflows triggered by CRON (no webhook endpoint — not tested here)
const CRON_WORKFLOWS = [
  { name: "Nightly Story Audit", schedule: "0 2 * * *", workflow: "WF_NIGHTLY_STORY_AUDIT" },
  { name: "Story Reminder",      schedule: "0 9 * * 1", workflow: "WF_STORY_REMINDER_CRON" },
];

async function testEndpoint(ep) {
  const url = `${N8N_URL}${ep.path}`;
  try {
    const res = await fetch(url, {
      method: ep.method,
      headers: {
        "Content-Type": "application/json",
        ...(API_KEY ? { "X-N8N-API-KEY": API_KEY } : {}),
      },
      body: JSON.stringify({
        message: "health_check",
        session_id: `webhook-test-${Date.now()}`,
        source: "aisha:webhooks:test",
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const text = await res.text();
    return { ...ep, status: res.status, ok: res.status >= 200 && res.status < 300, body: text.slice(0, 120), fullBody: text };
  } catch (err) {
    return { ...ep, status: 0, ok: false, body: err.message };
  }
}

async function main() {
  console.log(`\n🔍 AISHA Webhook Health Check`);
  console.log(`   Base URL: ${N8N_URL}\n`);

  // 1. Health check
  try {
    const health = await fetch(`${N8N_URL}/healthz`, { signal: AbortSignal.timeout(5_000) });
    const hb = await health.text();
    console.log(`   n8n health: ${health.status === 200 ? "✅" : "❌"} ${hb.trim()}\n`);
  } catch {
    console.log(`   n8n health: ❌ unreachable\n`);
    process.exit(1);
  }

  // 2. Webhook tests
  const results = [];
  for (const ep of ENDPOINTS) {
    const result = await testEndpoint(ep);
    results.push(result);
    const icon = result.ok ? "✅" : result.status === 404 ? "❌" : "⚠️";
    console.log(`   ${icon} [${String(result.status).padStart(3)}] ${ep.name.padEnd(20)} ${ep.path}`);
    if (!result.ok && result.status !== 0) {
      // Show hint from n8n response
      try {
        const j = JSON.parse(result.fullBody ?? result.body);
        if (j.hint) console.log(`        💡 ${j.hint.slice(0, 100)}`);
      } catch (parseErr) {
        console.warn(`        ⚠️  non-JSON error body (len=${result.body?.length ?? 0}): ${parseErr?.message || parseErr}`);
      }
    }
  }

  // 3. CRON workflows info
  if (CRON_WORKFLOWS.length > 0) {
    console.log(`\n   📅 CRON-triggered workflows (no webhook):`);
    for (const cw of CRON_WORKFLOWS) {
      console.log(`      ⏰ ${cw.name.padEnd(22)} ${cw.schedule.padEnd(12)} ${cw.workflow}`);
    }
  }

  // 4. Summary
  const passing = results.filter(r => r.ok).length;
  const total = results.length;
  console.log(`\n   ─────────────────────────────────────`);
  console.log(`   Result: ${passing}/${total} webhooks responding`);

  if (passing === 0) {
    console.log(`\n   ⚠️  Žádný webhook nefunguje!`);
    console.log(`   📖 Viz: docs/deploy/N8N_WEBHOOK_FIX.md`);
    console.log(`   🔑 Nejpravděpodobnější příčina: workflow nejsou v produkci aktivní/importované, nebo nesedí WEBHOOK_URL.\n`);
    process.exit(1);
  } else if (passing < total) {
    console.log(`\n   ⚠️  Některé webhooky nefungují — zkontroluj aktivaci workflow.\n`);
    process.exit(1);
  } else {
    console.log(`\n   ✅ Všechny webhooky fungují!\n`);
  }
}

main().catch(err => {
  console.error(`💥 ${err.message}`);
  process.exit(1);
});
