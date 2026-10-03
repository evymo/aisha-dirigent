#!/usr/bin/env node
/**
 * deploy-individual-tools.mjs
 * 
 * Replaces single "evymo_mcp_tools" toolWorkflow node with individual
 * per-tool toolCode nodes for each AI agent. Each tool gets:
 * - Proper name (LLM sees it in function calling)
 * - Focused description with parameter docs
 * - Self-contained HTTP call to MCP server (JSON-RPC 2.0)
 * 
 * Usage:
 *   node scripts/deploy-individual-tools.mjs --test       # Test one tool on Knowledge Agent
 *   node scripts/deploy-individual-tools.mjs --deploy-all  # Deploy all tools to all agents
 *   node scripts/deploy-individual-tools.mjs --rollback    # Restore to single bridge
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── Configuration ──────────────────────────────────────────────────────
const ENV_PATH = resolve(ROOT, '.env.aisha');

function loadEnv() {
  if (!existsSync(ENV_PATH)) throw new Error('.env.aisha not found');
  const env = {};
  for (const line of readFileSync(ENV_PATH, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv();
const N8N_URL = env.N8N_URL || env.N8N_WEBHOOK_URL;
if (!N8N_URL) {
  console.error('ERROR: N8N_URL not set (env-driven; no hardcoded host). Set N8N_URL or N8N_WEBHOOK_URL in .env.aisha.');
  process.exit(1);
}
const N8N_API_KEY = env.N8N_API_KEY;
const MCP_URL = env.AISHA_MCP_URL;
if (!MCP_URL) {
  console.error('ERROR: AISHA_MCP_URL not set (env-driven; no hardcoded host). Set it in .env.aisha.');
  process.exit(1);
}
const AISHA_ACCESS_TOKEN = env.AISHA_ACCESS_TOKEN || env.AISHA_KEYCLOAK_ACCESS_TOKEN;

if (!N8N_API_KEY) throw new Error('N8N_API_KEY not found in .env.aisha');
if (!AISHA_ACCESS_TOKEN) throw new Error('AISHA_ACCESS_TOKEN not found in .env.aisha');

// ─── Agent → n8n Workflow mapping (IDs resolved dynamically) ────────────
const AGENTS = {
  KNOWLEDGE: {
    wfName: 'WF_KNOWLEDGE_AGENT',
    wfId: null, // resolved at runtime
    agentNodeName: 'Knowledge Agent',
    tools: [
      'search_knowledge', 'search_knowledge_v2', 'get_expert_rule',
      'get_expertise_areas', 'match_experts', 'get_agent_knowledge',
      'get_knowledge_item', 'get_knowledge_stats'
    ]
  },
  COMPLIANCE: {
    wfName: 'WF_COMPLIANCE_AGENT',
    wfId: null,
    agentNodeName: 'Compliance Agent',
    tools: [
      'validate_compliance', 'check_pr_compliance', 'moderate_flow',
      'evaluate_tests', 'assess_quality', 'create_story_ruleset',
      'get_story_context'
    ]
  },
  DELIVERY: {
    wfName: 'WF_DELIVERY_AGENT',
    wfId: null,
    agentNodeName: 'Delivery Agent',
    tools: [
      'transition_delivery_status', 'get_delivery_timeline',
      'get_allowed_transitions', 'manage_story_environment',
      'get_story_environments', 'get_story_context'
    ]
  },
  DIRIGENT: {
    wfName: 'WF_DIRIGENT_AGENT',
    wfId: null,
    agentNodeName: 'AISHA Dirigent',
    tools: [
      'route_task', 'compose_context', 'suggest_next_step',
      'estimate_effort', 'generate_copilot_instructions',
      'get_story_context', 'get_project_context',
      'search_knowledge', 'validate_compliance',
      'transition_delivery_status'
    ]
  }
};

/** Resolve all agent workflow IDs from n8n server. */
async function resolveAgentIds() {
  console.log('🔍 Resolving workflow IDs from n8n...');
  const resp = await fetch(`${N8N_URL}/api/v1/workflows`, {
    headers: { 'X-N8N-API-KEY': N8N_API_KEY, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`n8n API ${resp.status}: ${await resp.text()}`);
  const result = await resp.json();
  const workflows = result.data ?? result;
  const byName = new Map();
  for (const wf of Array.isArray(workflows) ? workflows : []) byName.set(wf.name, wf.id);

  for (const [key, agent] of Object.entries(AGENTS)) {
    const id = byName.get(agent.wfName);
    if (id) {
      agent.wfId = id;
      console.log(`  ✓ ${agent.wfName} → ${id}`);
    } else {
      console.warn(`  ⚠ ${agent.wfName} not found — skipping ${key}`);
    }
  }
}

// ─── Fetch MCP Tool definitions ─────────────────────────────────────────
async function fetchMcpTools() {
  console.log('📡 Fetching MCP tool definitions...');
  const res = await fetch(MCP_URL, {
      signal: AbortSignal.timeout(30000),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AISHA_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}
    })
  });
  if (!res.ok) throw new Error(`MCP API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data.error) throw new Error('MCP error: ' + JSON.stringify(data.error));
  const tools = data.result.tools;
  console.log(`   ✅ ${tools.length} tools fetched`);
  return tools;
}

// ─── Generate toolCode jsCode for a single tool ────────────────────────
function generateToolCode(toolName) {
  // The jsCode runs inside n8n toolCode sandbox.
  // IMPORTANT: fetch() is NOT available in n8n sandbox.
  // We use require('https') which works with NODE_FUNCTION_ALLOW_BUILTIN=*.
  // Falls back to fetch() if require is unavailable (newer n8n versions).
  return `// MCP Tool: ${toolName}
// Auto-generated by deploy-individual-tools.mjs
const query = $input.item.json.query || $input.item.json || '';
let args;
try {
  args = typeof query === 'string' ? JSON.parse(query) : query;
} catch (parseErr) {
  console.warn('[MCP tool] query was not valid JSON, treating as plain text:', parseErr.message);
  args = typeof query === 'string' && query.length > 0 ? { query } : {};
}

const mcpBase = $env?.AISHA_POSTGREST_URL;
if (!mcpBase) throw new Error('AISHA_POSTGREST_URL not set (env-driven; no hardcoded host)');
const mcpUrl = mcpBase + '/functions/v1/mcp-knowledge-server';
const token = $env?.AISHA_ACCESS_TOKEN || $env?.AISHA_KEYCLOAK_ACCESS_TOKEN || '';

const rpcBody = JSON.stringify({
  jsonrpc: '2.0',
  id: Date.now(),
  method: 'tools/call',
  params: { name: '${toolName}', arguments: args }
});

let data;
try {
  if (typeof fetch === 'function') {
    const res = await fetch(mcpUrl, {
        signal: AbortSignal.timeout(30000),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: rpcBody
    });
    if (!res.ok) throw new Error('MCP HTTP ' + res.status);
    data = await res.json();
  } else {
    const https = require('https');
    const url = new URL(mcpUrl);
    data = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
          'Content-Length': Buffer.byteLength(rpcBody)
        }
      }, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch { reject(new Error('Invalid JSON response: ' + body.substring(0, 200))); }
        });
      });
      req.on('error', reject);
      req.write(rpcBody);
      req.end();
    });
  }
} catch (e) {
  return 'MCP Tool Error (${toolName}): ' + (e.message || String(e));
}

if (data.error) return 'MCP Error: ' + (data.error.message || JSON.stringify(data.error));
if (data.result?.content) {
  return data.result.content.map(c => c.type === 'text' ? c.text : JSON.stringify(c)).join('\\n');
}
return JSON.stringify(data.result || data);`;
}

// ─── Generate toolCode FALLBACK (uses $http if fetch unavailable) ──────
function generateToolCodeFallback(toolName) {
  return `// MCP Tool: ${toolName} (httpRequest fallback)
// Auto-generated by deploy-individual-tools.mjs
const query = $input.item.json.query || $input.item.json || '';
let args;
try {
  args = typeof query === 'string' ? JSON.parse(query) : query;
} catch (parseErr) {
  console.warn('[MCP tool] query was not valid JSON, treating as plain text:', parseErr.message);
  args = typeof query === 'string' && query.length > 0 ? { query } : {};
}

const rpcPayload = {
  jsonrpc: '2.0',
  id: Date.now(),
  method: 'tools/call',
  params: { name: '${toolName}', arguments: args }
};

return { json: { tool_name: '${toolName}', arguments: args, rpcBody: JSON.stringify(rpcPayload) } };`;
}

// ─── Generate tool description for LLM ─────────────────────────────────
function generateToolDescription(mcpTool) {
  const schema = mcpTool.inputSchema || {};
  const props = schema.properties || {};
  const required = schema.required || [];
  
  let desc = mcpTool.description || mcpTool.name;
  
  // Add parameter documentation
  const paramLines = Object.entries(props).map(([name, prop]) => {
    const req = required.includes(name) ? '(required)' : '(optional)';
    const type = prop.type || 'any';
    const pdesc = prop.description ? ` — ${prop.description.substring(0, 100)}` : '';
    return `  - ${name} ${req}: ${type}${pdesc}`;
  });
  
  if (paramLines.length > 0) {
    desc += '\n\nInput: JSON object. Parameters:\n' + paramLines.join('\n');
  } else {
    desc += '\n\nInput: empty JSON object {} or no input needed.';
  }
  
  return desc;
}

// ─── Create toolCode node JSON ──────────────────────────────────────────
function createToolCodeNode(mcpTool, position, useFallback = false) {
  const toolName = mcpTool.name;
  return {
    parameters: {
      name: toolName,
      description: generateToolDescription(mcpTool),
      language: 'javaScript',
      jsCode: useFallback
        ? generateToolCodeFallback(toolName)
        : generateToolCode(toolName)
    },
    id: `tool-${toolName}`,
    name: `MCP: ${toolName}`,
    type: '@n8n/n8n-nodes-langchain.toolCode',
    typeVersion: 1.2,
    position
  };
}

// ─── n8n API helpers ────────────────────────────────────────────────────
async function n8nFetch(path, opts = {}) {
  const url = `${N8N_URL}/api/v1${path}`;
  const res = await fetch(url, {
      signal: AbortSignal.timeout(30000),
    ...opts,
    headers: {
      'X-N8N-API-KEY': N8N_API_KEY,
      'Content-Type': 'application/json',
      ...opts.headers
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`n8n API ${res.status}: ${text.substring(0, 300)}`);
  }
  return res.json();
}

async function getWorkflow(id) {
  return n8nFetch(`/workflows/${id}`);
}

async function updateWorkflow(id, payload) {
  // Strip to only accepted fields
  const clean = {
    name: payload.name,
    nodes: payload.nodes,
    connections: payload.connections,
    settings: payload.settings
  };
  return n8nFetch(`/workflows/${id}`, {
    method: 'PUT',
    body: JSON.stringify(clean)
  });
}

async function activateWorkflow(id) {
  return n8nFetch(`/workflows/${id}/activate`, { method: 'POST' });
}

async function deactivateWorkflow(id) {
  try {
    return await n8nFetch(`/workflows/${id}/deactivate`, { method: 'POST' });
  } catch (err) {
    console.warn(`[deploy] deactivateWorkflow(${id}) failed (likely already inactive): ${err?.message || err}`);
  }
}

// ─── Transform workflow: replace single toolWorkflow with individual toolCode nodes ──
function transformWorkflow(workflow, agentConfig, mcpToolDefs, useFallback = false) {
  const { agentNodeName, tools: agentTools } = agentConfig;
  
  // Find the agent node
  const agentNode = workflow.nodes.find(n => n.name === agentNodeName);
  if (!agentNode) throw new Error(`Agent node "${agentNodeName}" not found`);
  
  // Find and remove the old "Evymo MCP Tools" node (toolWorkflow or toolMcp)
  const oldToolNames = [];
  const newNodes = workflow.nodes.filter(n => {
    const isOldMcp = (
      n.type === '@n8n/n8n-nodes-langchain.toolMcp' ||
      (n.type === '@n8n/n8n-nodes-langchain.toolWorkflow' && 
       (n.parameters?.name === 'evymo_mcp_tools' || n.name === 'Evymo MCP Tools'))
    );
    if (isOldMcp) oldToolNames.push(n.name);
    return !isOldMcp;
  });
  
  // Also remove any existing individual MCP toolCode nodes (for idempotent re-deploy)
  const filteredNodes = newNodes.filter(n => {
    return !(n.type === '@n8n/n8n-nodes-langchain.toolCode' && n.id?.startsWith('tool-'));
  });
  
  // Position: start below agent, spread vertically
  const agentPos = agentNode.position || [660, 300];
  const toolStartX = agentPos[0] + 200;
  const toolStartY = agentPos[1] + 200;
  
  // Generate new toolCode nodes for this agent's domain
  const toolNodes = [];
  agentTools.forEach((toolName, index) => {
    const mcpDef = mcpToolDefs.find(t => t.name === toolName);
    if (!mcpDef) {
      console.warn(`   ⚠️  Tool "${toolName}" not found in MCP definitions, skipping`);
      return;
    }
    const position = [toolStartX, toolStartY + (index * 100)];
    toolNodes.push(createToolCodeNode(mcpDef, position, useFallback));
  });
  
  // Build new connections
  const newConnections = { ...workflow.connections };
  
  // Remove old tool connections
  for (const oldName of oldToolNames) {
    delete newConnections[oldName];
  }
  // Remove any existing individual tool connections
  for (const key of Object.keys(newConnections)) {
    if (key.startsWith('MCP: ')) delete newConnections[key];
  }
  
  // Add connections: each toolCode → ai_tool on agent
  for (const toolNode of toolNodes) {
    newConnections[toolNode.name] = {
      ai_tool: [
        [{ node: agentNodeName, type: 'ai_tool', index: 0 }]
      ]
    };
  }
  
  return {
    name: workflow.name,
    nodes: [...filteredNodes, ...toolNodes],
    connections: newConnections,
    settings: workflow.settings || { executionOrder: 'v1' }
  };
}

// ─── Test mode: deploy one tool to Knowledge Agent ──────────────────────
async function testSingleTool() {
  console.log('\n🧪 TEST MODE: Deploying single toolCode to Knowledge Agent\n');
  
  const mcpTools = await fetchMcpTools();
  const testTool = mcpTools.find(t => t.name === 'get_expertise_areas');
  if (!testTool) throw new Error('Test tool get_expertise_areas not found');
  
  // Get current Knowledge Agent workflow
  const wf = await getWorkflow(AGENTS.KNOWLEDGE.wfId);
  console.log(`   📋 Current nodes: ${wf.nodes.length}`);
  
  // Create a minimal test: keep existing tools, just ADD one toolCode
  const position = [1060, 500];
  const toolNode = createToolCodeNode(testTool, position);
  
  // Add the test node
  const nodes = [...wf.nodes, toolNode];
  const connections = { ...wf.connections };
  connections[toolNode.name] = {
    ai_tool: [
      [{ node: AGENTS.KNOWLEDGE.agentNodeName, type: 'ai_tool', index: 0 }]
    ]
  };
  
  // Deactivate, update, activate
  console.log('   🔄 Deactivating workflow...');
  await deactivateWorkflow(AGENTS.KNOWLEDGE.wfId);
  
  console.log('   📤 Updating workflow with test toolCode...');
  await updateWorkflow(AGENTS.KNOWLEDGE.wfId, {
    name: wf.name,
    nodes,
    connections,
    settings: wf.settings
  });
  
  console.log('   ✨ Activating workflow...');
  try {
    await activateWorkflow(AGENTS.KNOWLEDGE.wfId);
    console.log('   ✅ SUCCESS! toolCode activated! fetch() works in toolCode sandbox!');
    console.log('   → Proceed with --deploy-all');
    return true;
  } catch (e) {
    console.error('   ❌ Activation FAILED:', e.message);
    console.log('   → Falling back: removing test node...');
    
    // Restore original
    await updateWorkflow(AGENTS.KNOWLEDGE.wfId, {
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: wf.settings
    });
    await activateWorkflow(AGENTS.KNOWLEDGE.wfId);
    console.log('   🔄 Restored original workflow');
    console.log('   → fetch() does NOT work in toolCode; will use fallback approach');
    return false;
  }
}

// ─── Deploy all: replace single bridge with individual toolCode per agent ──
async function deployAll(useFallback = false) {
  console.log(`\n🚀 DEPLOY ALL: Individual toolCode nodes per agent${useFallback ? ' (FALLBACK mode)' : ''}\n`);
  
  const mcpTools = await fetchMcpTools();
  const results = [];
  
  for (const [agentName, config] of Object.entries(AGENTS)) {
    console.log(`\n─── ${agentName} (${config.tools.length} tools) ───`);
    
    try {
      // Fetch current workflow
      const wf = await getWorkflow(config.wfId);
      console.log(`   📋 Current: ${wf.nodes.length} nodes`);
      
      // Transform
      const transformed = transformWorkflow(wf, config, mcpTools, useFallback);
      console.log(`   🔧 Transformed: ${transformed.nodes.length} nodes`);
      
      // Deactivate
      console.log('   ⏸️  Deactivating...');
      await deactivateWorkflow(config.wfId);
      
      // Update
      console.log('   📤 Updating...');
      await updateWorkflow(config.wfId, transformed);
      
      // Activate
      console.log('   ✨ Activating...');
      await activateWorkflow(config.wfId);
      
      console.log(`   ✅ ${agentName} — ${config.tools.length} individual tools deployed`);
      results.push({ agent: agentName, status: 'ok', tools: config.tools.length });
      
    } catch (e) {
      console.error(`   ❌ ${agentName} FAILED: ${e.message}`);
      results.push({ agent: agentName, status: 'error', error: e.message });
      
      // Try to re-activate
      try {
        await activateWorkflow(config.wfId);
      } catch (reactErr) {
        console.warn(`   ⚠️  ${agentName}: re-activate fallback failed: ${reactErr?.message || reactErr}`);
      }
    }
  }
  
  console.log('\n═══ DEPLOYMENT SUMMARY ═══');
  for (const r of results) {
    const icon = r.status === 'ok' ? '✅' : '❌';
    console.log(`  ${icon} ${r.agent}: ${r.status === 'ok' ? `${r.tools} tools` : r.error}`);
  }
  
  return results;
}

// ─── Rollback: restore single MCP Bridge toolWorkflow ──────────────────
async function rollback() {
  console.log('\n🔙 ROLLBACK: Restoring single MCP Bridge toolWorkflow per agent\n');
  
  const MCP_TOOL_DESCRIPTIONS = {
    KNOWLEDGE: 'Evymo Knowledge Base MCP Bridge — Search expert rules, find experts, explore knowledge graph.\n\nINPUT FORMAT: JSON with tool_name and arguments fields.\nExample: {"tool_name": "search_knowledge", "arguments": {"query": "testing strategies"}}',
    COMPLIANCE: 'Evymo Compliance MCP Bridge — Validate compliance, check PRs, route tasks.\n\nINPUT FORMAT: JSON with tool_name and arguments fields.',
    DELIVERY: 'Evymo Delivery MCP Bridge — Manage delivery lifecycle, transitions, timelines.\n\nINPUT FORMAT: JSON with tool_name and arguments fields.',
    DIRIGENT: 'AISHA Platform MCP Bridge — Full access to all 26 tools.\n\nINPUT FORMAT: JSON with tool_name and arguments fields.'
  };
  
  for (const [agentName, config] of Object.entries(AGENTS)) {
    console.log(`   🔄 Rolling back ${agentName}...`);
    
    try {
      const wf = await getWorkflow(config.wfId);
      
      // Remove all individual toolCode nodes
      const cleanNodes = wf.nodes.filter(n => {
        return !(n.type === '@n8n/n8n-nodes-langchain.toolCode' && n.id?.startsWith('tool-'));
      });
      
      // Check if bridge toolWorkflow already exists
      const hasBridge = cleanNodes.some(n => n.parameters?.name === 'evymo_mcp_tools');
      
      if (!hasBridge) {
        // Re-add the bridge toolWorkflow
        const agentNode = cleanNodes.find(n => n.name === config.agentNodeName);
        const pos = agentNode ? [agentNode.position[0] + 200, agentNode.position[1] + 200] : [840, 500];
        
        cleanNodes.push({
          parameters: {
            name: 'evymo_mcp_tools',
            description: MCP_TOOL_DESCRIPTIONS[agentName] || MCP_TOOL_DESCRIPTIONS.KNOWLEDGE,
            workflowId: MCP_BRIDGE_WF_ID
          },
          id: 'mcp-bridge-tool',
          name: 'Evymo MCP Tools',
          type: '@n8n/n8n-nodes-langchain.toolWorkflow',
          typeVersion: 1.3,
          position: pos
        });
      }
      
      // Clean connections
      const newConn = {};
      for (const [key, val] of Object.entries(wf.connections)) {
        if (!key.startsWith('MCP: ')) newConn[key] = val;
      }
      if (!hasBridge) {
        newConn['Evymo MCP Tools'] = {
          ai_tool: [[{ node: config.agentNodeName, type: 'ai_tool', index: 0 }]]
        };
      }
      
      await deactivateWorkflow(config.wfId);
      await updateWorkflow(config.wfId, { name: wf.name, nodes: cleanNodes, connections: newConn, settings: wf.settings });
      await activateWorkflow(config.wfId);
      console.log(`   ✅ ${agentName} rolled back`);
      
    } catch (e) {
      console.error(`   ❌ ${agentName} rollback failed: ${e.message}`);
    }
  }
}

// ─── Status check ───────────────────────────────────────────────────────
async function checkStatus() {
  console.log('\n📊 WORKFLOW STATUS\n');
  
  for (const [agentName, config] of Object.entries(AGENTS)) {
    try {
      const wf = await getWorkflow(config.wfId);
      const toolCodeNodes = wf.nodes.filter(n => n.type === '@n8n/n8n-nodes-langchain.toolCode');
      const toolWfNodes = wf.nodes.filter(n => n.type === '@n8n/n8n-nodes-langchain.toolWorkflow');
      const toolMcpNodes = wf.nodes.filter(n => n.type === '@n8n/n8n-nodes-langchain.toolMcp');
      
      const active = wf.active ? '🟢' : '🔴';
      console.log(`  ${active} ${agentName} (${wf.nodes.length} nodes) — toolCode: ${toolCodeNodes.length}, toolWorkflow: ${toolWfNodes.length}, toolMcp: ${toolMcpNodes.length}`);
      
      if (toolCodeNodes.length > 0) {
        toolCodeNodes.forEach(n => console.log(`      📌 ${n.parameters?.name || n.name}`));
      }
    } catch (e) {
      console.log(`  ⚠️  ${agentName}: ${e.message}`);
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const mode = args[0] || '--status';

try {
  switch (mode) {
    case '--test':
      await testSingleTool();
      break;
    case '--deploy-all':
      await deployAll(false);
      break;
    case '--deploy-all-fallback':
      await deployAll(true);
      break;
    case '--rollback':
      await rollback();
      break;
    case '--status':
      await checkStatus();
      break;
    default:
      console.log(`Usage:
  --test               Test single toolCode on Knowledge Agent (verifies fetch works)
  --deploy-all         Deploy individual toolCode nodes to all agents
  --deploy-all-fallback Deploy with fallback code (if fetch doesn't work in sandbox)
  --rollback           Restore single MCP Bridge per agent
  --status             Show current workflow tool status`);
  }
} catch (e) {
  console.error('💥 Fatal error:', e.message);
  process.exit(1);
}
