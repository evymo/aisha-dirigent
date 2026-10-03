#!/usr/bin/env node
import { readFileSync } from 'fs';
import { N8N_URL, N8N_API_KEY } from './lib/env.mjs';

const API = `${N8N_URL}/api/v1`;
const KEY = N8N_API_KEY;
const json = JSON.parse(readFileSync('n8n/workflows/WF_DIRIGENT_AGENT.json','utf8'));
const {nodes,connections,settings,name} = json;
const res = await fetch(`${API}/workflows/b8RBexT2LWUjy2Yq`, {
    signal: AbortSignal.timeout(30000),
  method:'PUT',
  headers:{'Content-Type':'application/json','X-N8N-API-KEY':KEY},
  body:JSON.stringify({nodes,connections,settings,name})
});
if (!res.ok) { console.error(`Deploy failed: ${res.status} ${await res.text()}`); process.exit(1); }
const d = await res.json();
if (d.nodes) console.log(`Deployed: ${d.nodes.length} nodes`);
else console.log('Error:', JSON.stringify(d));
