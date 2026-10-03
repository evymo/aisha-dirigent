#!/usr/bin/env python3
"""Activate n8n workflows that failed activation during setup."""
import json
import os
import subprocess
import sys

# Load env
env_path = os.path.join(os.path.dirname(__file__), '..', '.env.aisha')
env = {}
with open(env_path) as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            env[k] = v.strip().strip('"').strip("'")

N8N_API_KEY = env.get('N8N_API_KEY', '')
N8N_URL = env.get('N8N_URL') or env.get('N8N_BASE_URL', '')

if not N8N_API_KEY:
    print("ERROR: N8N_API_KEY not found in .env.aisha")
    sys.exit(1)

if not N8N_URL:
    print("ERROR: N8N_URL (or N8N_BASE_URL) not found in .env.aisha")
    sys.exit(1)

# Workflows to activate — sourced from env (comma-separated N8N_WORKFLOW_IDS).
# Expected workflows (documentation only):
#   WF_DIRIGENT_AGENT, WF_KNOWLEDGE_AGENT, WF_COMPLIANCE_AGENT, WF_DELIVERY_AGENT
WORKFLOW_IDS = [
    wf_id.strip()
    for wf_id in env.get('N8N_WORKFLOW_IDS', '').split(',')
    if wf_id.strip()
]

if not WORKFLOW_IDS:
    print("ERROR: N8N_WORKFLOW_IDS not found in .env.aisha")
    sys.exit(1)

headers = {
    'X-N8N-API-KEY': N8N_API_KEY,
    'Content-Type': 'application/json',
}

for wf_id in WORKFLOW_IDS:
    print(f"\n--- Activating {wf_id} ---")
    
    # Fetch workflow
    import urllib.request
    req = urllib.request.Request(
        f'{N8N_URL}/api/v1/workflows/{wf_id}',
        headers=headers
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        wf = json.loads(resp.read())
    
    print(f"  Name: {wf['name']}")
    print(f"  Current active: {wf.get('active')}")
    print(f"  Nodes: {len(wf.get('nodes', []))}")
    
    # Check for toolMcp nodes
    for node in wf.get('nodes', []):
        if 'toolMcp' in node.get('type', ''):
            print(f"  Has toolMcp node: {node['name']}")
    
    # Build update payload
    payload = {
        'name': wf['name'],
        'nodes': wf['nodes'],
        'connections': wf['connections'],
        'settings': wf.get('settings', {}),
        'active': True
    }
    
    # PUT update to activate
    data = json.dumps(payload).encode('utf-8')
    req2 = urllib.request.Request(
        f'{N8N_URL}/api/v1/workflows/{wf_id}',
        data=data,
        headers=headers,
        method='PUT'
    )
    
    try:
        with urllib.request.urlopen(req2, timeout=30) as resp2:
            result = json.loads(resp2.read())
            print(f"  Result: active={result.get('active')}")
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        print(f"  HTTP Error {e.code}: {body[:500]}")
    except Exception as e:
        print(f"  Error: {e}")

print("\n--- Final status ---")
req = urllib.request.Request(
    f'{N8N_URL}/api/v1/workflows',
    headers=headers
)
with urllib.request.urlopen(req, timeout=30) as resp:
    data = json.loads(resp.read())
    wfs = data.get('data', data)
    for w in wfs:
        status = "ACTIVE" if w.get('active') else "inactive"
        print(f"  [{status:8s}] {w['id']:20s} {w['name']}")
