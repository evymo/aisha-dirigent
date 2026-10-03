/**
 * scripts/lib/n8n-resolve.mjs — Resolve n8n workflow IDs by name
 *
 * Usage:
 *   import { resolveWorkflowIds, resolveWorkflowId } from './lib/n8n-resolve.mjs';
 *
 *   // Resolve single workflow
 *   const id = await resolveWorkflowId('WF_KNOWLEDGE_AGENT');
 *
 *   // Resolve map of name→id
 *   const map = await resolveWorkflowIds(['WF_KNOWLEDGE_AGENT', 'WF_DIRIGENT_AGENT']);
 */
import { N8N_URL, requireN8nApiKey } from './env.mjs';

/**
 * Fetch all workflows from n8n and return Map<name, id>.
 */
async function fetchWorkflowMap() {
  const apiKey = requireN8nApiKey();
  const resp = await fetch(`${N8N_URL}/api/v1/workflows`, {
    headers: {
      'X-N8N-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    throw new Error(`n8n API ${resp.status}: ${await resp.text()}`);
  }

  const result = await resp.json();
  const workflows = result.data ?? result;
  const map = new Map();
  for (const wf of Array.isArray(workflows) ? workflows : []) {
    map.set(wf.name, wf.id);
  }
  return map;
}

/**
 * Resolve a single workflow name to its server ID.
 * @param {string} name - Workflow name (e.g. 'WF_KNOWLEDGE_AGENT')
 * @returns {Promise<string>} Workflow ID
 * @throws If workflow not found
 */
export async function resolveWorkflowId(name) {
  const map = await fetchWorkflowMap();
  const id = map.get(name);
  if (!id) throw new Error(`Workflow "${name}" not found on n8n server`);
  return id;
}

/**
 * Resolve multiple workflow names to IDs.
 * @param {string[]} names - Array of workflow names
 * @returns {Promise<Map<string, string>>} Map of name→id (only resolved entries)
 */
export async function resolveWorkflowIds(names) {
  const map = await fetchWorkflowMap();
  const result = new Map();
  for (const name of names) {
    const id = map.get(name);
    if (id) {
      result.set(name, id);
    } else {
      console.warn(`  ⚠ Workflow "${name}" not found on n8n server`);
    }
  }
  return result;
}
