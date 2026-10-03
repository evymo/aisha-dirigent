#!/usr/bin/env tsx
/**
 * seed-graphs.ts — deploy-time pusher for platform graphs.
 *
 * Reads JSON files from src/graphs/*.json and upserts them into
 * ai_workflow_definitions. Used during cold-start bootstrap (Step 11+).
 *
 * Idempotent: matches on `name`. Updates display_name, description,
 * graph, context, metadata, is_active, version. Sets created_by=NULL
 * (system seed); partner-edited copies are protected by created_by IS NOT NULL
 * filter at update time (we never overwrite tenant-created graphs).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const graphsDir = join(__dirname, '..', 'src', 'graphs');

const POSTGREST_URL = process.env.POSTGREST_URL ?? 'http://postgrest:3000';
const TOKEN = process.env.POSTGREST_SERVICE_TOKEN ?? '';

interface GraphFile {
  name: string;
  display_name: string;
  description: string;
  context: string;
  version: number;
  is_active: boolean;
  metadata: Record<string, unknown>;
  graph: Record<string, unknown>;
}

async function upsertGraph(graph: GraphFile): Promise<void> {
  // Check if a tenant-edited copy exists (created_by IS NOT NULL).
  // If yes, skip platform upsert to respect tenant customization.
  const existingRes = await fetch(
    `${POSTGREST_URL}/ai_workflow_definitions?name=eq.${encodeURIComponent(graph.name)}&select=id,created_by,version`,
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/json',
      },
    },
  );

  if (!existingRes.ok) {
    throw new Error(`Failed to query existing graph ${graph.name}: HTTP ${existingRes.status}`);
  }

  const existing = (await existingRes.json()) as Array<{ id: string; created_by: string | null; version: number }>;
  const tenantOwned = existing.find((r) => r.created_by !== null);
  if (tenantOwned) {
    console.log(`[seed-graphs] ${graph.name} has tenant copy (created_by=${tenantOwned.created_by}); skipping platform upsert`);
    return;
  }

  const platformExisting = existing.find((r) => r.created_by === null);

  const payload = {
    name: graph.name,
    display_name: graph.display_name,
    description: graph.description,
    context: graph.context,
    version: graph.version,
    is_active: graph.is_active,
    metadata: graph.metadata,
    graph: graph.graph,
    created_by: null,
    updated_by: null,
  };

  if (platformExisting) {
    // Update only if version increased
    if (platformExisting.version >= graph.version) {
      console.log(`[seed-graphs] ${graph.name} platform copy at version ${platformExisting.version} >= ${graph.version}; skipping`);
      return;
    }
    const updateRes = await fetch(
      `${POSTGREST_URL}/ai_workflow_definitions?id=eq.${encodeURIComponent(platformExisting.id)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(payload),
      },
    );
    if (!updateRes.ok) {
      const txt = await updateRes.text();
      throw new Error(`Update ${graph.name} failed: HTTP ${updateRes.status} ${txt}`);
    }
    console.log(`[seed-graphs] ✓ updated ${graph.name} to version ${graph.version}`);
  } else {
    const insertRes = await fetch(`${POSTGREST_URL}/ai_workflow_definitions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    });
    if (!insertRes.ok) {
      const txt = await insertRes.text();
      throw new Error(`Insert ${graph.name} failed: HTTP ${insertRes.status} ${txt}`);
    }
    console.log(`[seed-graphs] ✓ inserted ${graph.name} version ${graph.version}`);
  }
}

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error('[seed-graphs] POSTGREST_SERVICE_TOKEN is required');
    process.exit(1);
  }

  const files = readdirSync(graphsDir).filter((f) => f.endsWith('.json'));
  console.log(`[seed-graphs] found ${files.length} graph file(s) in ${graphsDir}`);

  let failures = 0;
  for (const file of files) {
    const path = join(graphsDir, file);
    try {
      const raw = readFileSync(path, 'utf-8');
      const graph = JSON.parse(raw) as GraphFile;
      await upsertGraph(graph);
    } catch (err) {
      failures++;
      console.error(`[seed-graphs] ✗ failed for ${file}:`, err);
    }
  }

  if (failures > 0) {
    console.error(`[seed-graphs] completed with ${failures} failure(s)`);
    process.exit(1);
  }
  console.log('[seed-graphs] done');
}

void main();
