#!/usr/bin/env node
/**
 * Deploy MCP Bridge Fix
 * 
 * Replaces broken toolMcp nodes with toolWorkflow → WF_MCP_BRIDGE
 * in all 4 agent workflows that can't activate.
 * 
 * Usage: N8N_API_KEY=<key> node scripts/deploy-mcp-bridge.mjs
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { N8N_URL } from './lib/env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = join(__dirname, '..', 'n8n', 'workflows');
const N8N_API_KEY = process.env.N8N_API_KEY;

if (!N8N_API_KEY) {
  console.error('ERROR: N8N_API_KEY environment variable required');
  process.exit(1);
}

const headers = {
  'X-N8N-API-KEY': N8N_API_KEY,
  'Content-Type': 'application/json',
};

// Workflow IDs resolved dynamically from n8n server
const WORKFLOW_NAME_MAP = {
  DIRIGENT: 'WF_DIRIGENT_AGENT',
  KNOWLEDGE: 'WF_KNOWLEDGE_AGENT',
  COMPLIANCE: 'WF_COMPLIANCE_AGENT',
  DELIVERY: 'WF_DELIVERY_AGENT',
};

/** Resolve workflow IDs by name from n8n. */
async function resolveWorkflowIds() {
  const resp = await fetch(`${N8N_URL}/api/v1/workflows`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`n8n API ${resp.status}`);
  const result = await resp.json();
  const wfs = result.data ?? result;
  const byName = new Map();
  for (const wf of Array.isArray(wfs) ? wfs : []) byName.set(wf.name, wf.id);

  const ids = {};
  for (const [key, name] of Object.entries(WORKFLOW_NAME_MAP)) {
    const id = byName.get(name);
    if (id) {
      ids[key] = id;
    } else {
      console.warn(`  ⚠ ${name} not found on n8n server`);
    }
  }
  return ids;
}

// MCP tool descriptions per agent role
const MCP_TOOL_DESCRIPTIONS = {
  DIRIGENT: `Evymo MCP Bridge — Call any Evymo platform tool via MCP protocol.

INPUT FORMAT: JSON with tool_name and arguments fields.
Example: {"tool_name": "search_knowledge", "arguments": {"query": "AI agent best practices"}}

AVAILABLE TOOLS:
- search_knowledge(query, limit?) — full-text search in knowledge base
- search_knowledge_v2(query, limit?) — semantic vector search (more precise)
- get_expert_rule(rule_id) — get detail of specific expert rule
- get_expertise_areas() — list all expertise areas
- match_experts(context, limit?) — match experts to a context
- get_agent_knowledge(agent_type) — get rules for agent type
- get_project_context(project_id) — get project context
- get_knowledge_stats() — knowledge base statistics
- get_story_context(story_id) — story context with rules
- create_story_ruleset(story_id, rules) — create story ruleset
- route_task(task_kind, context) — route task to appropriate handler
- compose_context(context_type, params) — compose context for evaluation
- validate_compliance(story_id) — validate compliance rules
- moderate_flow(context) — moderate development flow
- evaluate_tests(context) — evaluate test strategy
- assess_quality(context) — assess code quality
- suggest_next_step(context) — suggest next action
- estimate_effort(description) — estimate effort
- check_pr_compliance(pr_number, repo) — check PR compliance
- transition_delivery_status(story_id, target_status, reason) — transition delivery
- get_delivery_timeline(story_id) — delivery timeline history
- get_allowed_transitions(story_id) — allowed state transitions
- manage_story_environment(story_id, env_type, url) — manage environments
- get_story_environments(story_id) — list story environments
- generate_copilot_instructions(context) — generate copilot instructions
- get_knowledge_item(item_id) — get specific knowledge item`,

  KNOWLEDGE: `Evymo Knowledge Base MCP Bridge — Search expert rules, find experts, explore knowledge graph.

INPUT FORMAT: JSON with tool_name and arguments fields.
Example: {"tool_name": "search_knowledge", "arguments": {"query": "testing strategies"}}

AVAILABLE TOOLS:
- search_knowledge(query, limit?) — full-text search in knowledge base
- search_knowledge_v2(query, limit?) — semantic vector search (more precise)
- get_expert_rule(rule_id) — get detail of specific expert rule
- get_expertise_areas() — list all expertise areas
- match_experts(context, limit?) — match experts to a context
- get_agent_knowledge(agent_type) — get rules for agent type
- get_project_context(project_id) — get project context
- get_knowledge_stats() — knowledge base statistics
- get_knowledge_item(item_id) — get specific knowledge item`,

  COMPLIANCE: `Evymo Compliance MCP Bridge — Validate compliance, check PRs, route tasks, compose context.

INPUT FORMAT: JSON with tool_name and arguments fields.
Example: {"tool_name": "validate_compliance", "arguments": {"story_id": "abc-123"}}

AVAILABLE TOOLS:
- validate_compliance(story_id) — validate compliance rules for a story
- check_pr_compliance(pr_number, repo) — check PR against compliance rules
- route_task(task_kind, context) — route task to appropriate handler
- compose_context(context_type, params) — compose evaluation context
- get_story_context(story_id) — get story context with rules
- create_story_ruleset(story_id, rules) — create/update story ruleset
- search_knowledge(query, limit?) — search knowledge base for rules`,

  DELIVERY: `Evymo Delivery MCP Bridge — Manage delivery lifecycle, transitions, timelines, environments.

INPUT FORMAT: JSON with tool_name and arguments fields.
Example: {"tool_name": "get_delivery_timeline", "arguments": {"story_id": "abc-123"}}

AVAILABLE TOOLS:
- transition_delivery_status(story_id, target_status, reason) — transition delivery status
- get_delivery_timeline(story_id) — view delivery timeline history
- get_allowed_transitions(story_id) — check allowed state transitions
- manage_story_environment(story_id, env_type, url) — manage story environments
- get_story_environments(story_id) — list environments for story
- get_story_context(story_id) — get complete story context
- estimate_effort(description) — estimate effort for a task
- search_knowledge(query, limit?) — search relevant knowledge rules`,
};

async function n8nFetch(path, opts = {}) {
  const res = await fetch(`${N8N_URL}${path}`, { signal: AbortSignal.timeout(30_000), headers, ...opts });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error(`  Non-JSON response from ${path}:`, text.substring(0, 200));
    return { error: 'non-json', raw: text };
  }
}

async function importBridge() {
  console.log('\n=== Step 1: Import WF_MCP_BRIDGE ===');
  
  const bridgeJson = JSON.parse(readFileSync(join(WORKFLOWS_DIR, 'WF_MCP_BRIDGE.json'), 'utf8'));
  
  // Strip properties that API doesn't accept
  const apiPayload = {
    name: bridgeJson.name,
    nodes: bridgeJson.nodes,
    connections: bridgeJson.connections,
    settings: bridgeJson.settings || { executionOrder: 'v1' },
  };
  
  // Check if bridge already exists
  const existing = await n8nFetch('/api/v1/workflows');
  const existingBridge = existing.data?.find(w => w.name === 'WF_MCP_BRIDGE');
  
  if (existingBridge) {
    console.log(`  Bridge already exists (ID: ${existingBridge.id}), updating...`);
    const updated = await n8nFetch(`/api/v1/workflows/${existingBridge.id}`, {
      method: 'PUT',
      body: JSON.stringify(apiPayload),
    });
    if (updated.id) {
      console.log(`  ✅ Updated bridge: ${updated.id}`);
      return updated.id;
    } else {
      console.error('  ❌ Update failed:', updated.message);
      // Try delete + recreate
      await n8nFetch(`/api/v1/workflows/${existingBridge.id}`, { method: 'DELETE' });
    }
  }
  
  // Create new
  const created = await n8nFetch('/api/v1/workflows', {
    method: 'POST',
    body: JSON.stringify(apiPayload),
  });
  
  if (created.id) {
    console.log(`  ✅ Created bridge: ${created.id}`);
    return created.id;
  } else {
    console.error('  ❌ Create failed:', created.message);
    return null;
  }
}

function buildToolWorkflowNode(agentKey, bridgeId, originalNode) {
  return {
    parameters: {
      name: 'evymo_mcp_tools',
      description: MCP_TOOL_DESCRIPTIONS[agentKey],
      workflowId: bridgeId,
    },
    id: originalNode.id || 'mcp-client',
    name: originalNode.name || 'Evymo MCP Tools',
    type: '@n8n/n8n-nodes-langchain.toolWorkflow',
    typeVersion: 2,
    position: originalNode.position || [860, 520],
  };
}

async function updateAgentWorkflow(agentKey, workflowId, bridgeId) {
  console.log(`\n  Updating ${agentKey} (${workflowId})...`);
  
  // Fetch current workflow from n8n
  const current = await n8nFetch(`/api/v1/workflows/${workflowId}`);
  if (!current.id) {
    console.error(`    ❌ Failed to fetch: ${current.message}`);
    return false;
  }
  
  // Find and replace toolMcp node
  const mcpNodeIndex = current.nodes.findIndex(n => n.type === '@n8n/n8n-nodes-langchain.toolMcp');
  if (mcpNodeIndex === -1) {
    console.log(`    ⚠️ No toolMcp node found (already replaced?)`);
    // Check if toolWorkflow with name 'evymo_mcp_tools' already exists
    const existing = current.nodes.find(n => 
      n.type === '@n8n/n8n-nodes-langchain.toolWorkflow' && 
      n.parameters?.name === 'evymo_mcp_tools'
    );
    if (existing) {
      console.log(`    ✅ Already has MCP bridge tool`);
      return true;
    }
    return false;
  }
  
  const originalNode = current.nodes[mcpNodeIndex];
  console.log(`    Found toolMcp: "${originalNode.name}" at index ${mcpNodeIndex}`);
  
  // Build replacement node
  const replacement = buildToolWorkflowNode(agentKey, bridgeId, originalNode);
  
  // Replace in nodes array
  current.nodes[mcpNodeIndex] = replacement;
  
  // Update connections: find any connection FROM the old node name and update
  const oldName = originalNode.name;
  const newName = replacement.name;
  
  if (oldName !== newName) {
    // Rename in connections
    if (current.connections[oldName]) {
      current.connections[newName] = current.connections[oldName];
      delete current.connections[oldName];
    }
    // Also update references TO this node
    for (const [srcNode, connTypes] of Object.entries(current.connections)) {
      for (const [connType, outputs] of Object.entries(connTypes)) {
        for (const output of outputs) {
          for (const conn of output) {
            if (conn.node === oldName) {
              conn.node = newName;
            }
          }
        }
      }
    }
  }
  
  // PUT updated workflow — only include API-accepted fields
  const putPayload = {
    name: current.name,
    nodes: current.nodes,
    connections: current.connections,
    settings: current.settings || { executionOrder: 'v1' },
  };
  
  const result = await n8nFetch(`/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    body: JSON.stringify(putPayload),
  });
  
  if (result.id) {
    console.log(`    ✅ Updated successfully`);
    return true;
  } else {
    console.error(`    ❌ Update failed:`, result.message || JSON.stringify(result).substring(0, 200));
    return false;
  }
}

async function activateWorkflow(name, id) {
  const result = await n8nFetch(`/api/v1/workflows/${id}/activate`, { method: 'POST' });
  if (result.active) {
    console.log(`  ✅ ${name}: ACTIVATED`);
    return true;
  } else {
    console.log(`  ❌ ${name}: ${result.message || 'unknown error'}`);
    return false;
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  MCP Bridge Deployment                   ║');
  console.log('║  Fixes toolMcp activation failure         ║');
  console.log('╚══════════════════════════════════════════╝');
  
  // Step 1: Import bridge workflow
  const bridgeId = await importBridge();
  if (!bridgeId) {
    console.error('\n❌ FATAL: Could not create MCP Bridge workflow');
    process.exit(1);
  }
  
  // Step 2: Activate bridge
  console.log('\n=== Step 2: Activate MCP Bridge ===');
  const bridgeActive = await activateWorkflow('WF_MCP_BRIDGE', bridgeId);
  if (!bridgeActive) {
    console.error('  ⚠️ Bridge did not activate, but continuing (it may work without activation for sub-workflow calls)');
  }
  
  // Step 3: Resolve agent workflow IDs and update
  console.log('\n=== Step 3: Resolve & Update Agent Workflows ===');
  const WORKFLOW_IDS = await resolveWorkflowIds();
  const results = {};
  for (const [key, id] of Object.entries(WORKFLOW_IDS)) {
    results[key] = await updateAgentWorkflow(key, id, bridgeId);
  }
  
  // Step 4: Activate agent workflows
  console.log('\n=== Step 4: Activate Agent Workflows ===');
  const activationResults = {};
  for (const [key, id] of Object.entries(WORKFLOW_IDS)) {
    if (results[key]) {
      activationResults[key] = await activateWorkflow(`WF_${key}_AGENT`, id);
    } else {
      console.log(`  ⏭️ Skipping ${key} (update failed)`);
      activationResults[key] = false;
    }
  }
  
  // Summary
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  Deployment Summary                       ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  MCP Bridge: ${bridgeId} ${bridgeActive ? '✅' : '⚠️'}`);
  for (const [key, id] of Object.entries(WORKFLOW_IDS)) {
    const updated = results[key] ? '✅' : '❌';
    const activated = activationResults[key] ? '✅' : '❌';
    console.log(`  ${key}: ${id} update=${updated} active=${activated}`);
  }
  
  const allActive = Object.values(activationResults).every(v => v);
  if (allActive) {
    console.log('\n🎉 All workflows activated successfully!');
  } else {
    const failed = Object.entries(activationResults).filter(([, v]) => !v).map(([k]) => k);
    console.log(`\n⚠️ Some workflows failed: ${failed.join(', ')}`);
    console.log(`   Check n8n UI for details: ${N8N_URL}`);
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
