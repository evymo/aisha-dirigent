#!/usr/bin/env python3
"""Deploy transformed workflow JSONs to n8n via REST API.

Reads local workflow JSON files, extracts nodes and connections,
and PATCHes them to the running n8n instance.
"""

import json
import subprocess
import sys
import os

# Workflow file → n8n ID mapping
WORKFLOWS = {
    "n8n/workflows/WF_DIRIGENT_AGENT.json": "tZjimp6d7y3Ij4Jx",
    "n8n/workflows/WF_COMPLIANCE_AGENT.json": "SbBkafE3ArP1NE6K",
    "n8n/workflows/WF_DELIVERY_AGENT.json": "aR8OEsTTJPkQWPQo",
    "n8n/workflows/WF_KNOWLEDGE_AGENT.json": "P0gBfrbCYrLkSEYX",
    "n8n/workflows/WF_RAGNAROK_AGENT.json": "xSsPwLFQfvrRdafG",
    "n8n/workflows/WF_GUILD_MATCH.json": "eY5jpGkeZ8GkyjbN",
}

N8N_CONTAINER = "evymo-ai-orchestrator-n8n-1"
N8N_BASE = "http://localhost:5678/api/v1"


def get_api_key():
    """Read N8N_API_KEY from .env file."""
    env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("N8N_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("N8N_API_KEY not found in .env")


def n8n_api_put(path, data):
    """Call n8n REST API PUT via docker exec + node (file-based for large payloads)."""
    api_key = get_api_key()
    url = f"{N8N_BASE}{path}"

    # Write payload to temp file, docker cp, then node reads it
    import tempfile
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(data, f)
        tmp_path = f.name

    try:
        # Copy to container
        subprocess.run(
            ["docker", "cp", tmp_path, f"{N8N_CONTAINER}:/tmp/_wf_payload.json"],
            check=True, capture_output=True, timeout=10
        )

        js_code = f"""
const http = require('http');
const fs = require('fs');
const data = fs.readFileSync('/tmp/_wf_payload.json', 'utf8');
const req = http.request({{
  hostname: 'localhost',
  port: 5678,
  path: '{path}',
  method: 'PUT',
  headers: {{
    'Content-Type': 'application/json',
    'X-N8N-API-KEY': '{api_key}',
    'Content-Length': Buffer.byteLength(data)
  }}
}}, (res) => {{
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {{
    const result = {{ status: res.statusCode, body: body.substring(0, 500) }};
    process.stdout.write(JSON.stringify(result));
  }});
}});
req.on('error', e => {{
  process.stderr.write(e.message);
  process.exit(1);
}});
req.write(data);
req.end();
"""
        result = subprocess.run(
            ["docker", "exec", N8N_CONTAINER, "node", "-e", js_code],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            raise RuntimeError(f"API call failed: {result.stderr}")

        resp = json.loads(result.stdout)
        return resp.get("status", 0), resp.get("body", "")
    finally:
        os.unlink(tmp_path)


def n8n_api_activate(path, active):
    """Activate/deactivate a workflow via POST."""
    api_key = get_api_key()

    js_code = f"""
const http = require('http');
const data = JSON.stringify({{ active: {'true' if active else 'false'} }});
const req = http.request({{
  hostname: 'localhost',
  port: 5678,
  path: '{path}/{"activate" if active else "deactivate"}',
  method: 'POST',
  headers: {{
    'Content-Type': 'application/json',
    'X-N8N-API-KEY': '{api_key}',
    'Content-Length': Buffer.byteLength(data)
  }}
}}, (res) => {{
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {{
    process.stdout.write(String(res.statusCode));
  }});
}});
req.on('error', e => process.exit(1));
req.write(data);
req.end();
"""
    result = subprocess.run(
        ["docker", "exec", N8N_CONTAINER, "node", "-e", js_code],
        capture_output=True, text=True, timeout=15
    )
    return result.stdout.strip()


def deploy_workflow(file_path, workflow_id):
    """Deploy a single workflow to n8n."""
    print(f"\n{'='*60}")
    print(f"Deploying: {os.path.basename(file_path)} -> {workflow_id}")

    # Read local JSON
    with open(file_path) as f:
        local_wf = json.load(f)

    nodes = local_wf.get("nodes", [])
    connections = local_wf.get("connections", {})
    settings = local_wf.get("settings", {})

    # Count node types for verification
    node_types = {}
    for n in nodes:
        t = n["type"]
        node_types[t] = node_types.get(t, 0) + 1

    print(f"  Nodes: {len(nodes)} total")
    for t, c in sorted(node_types.items()):
        print(f"    {t}: {c}")

    has_llm_router = any(
        n["type"] == "n8n-nodes-aisha.aishaLlmRouter" for n in nodes
    )
    has_openai = any(
        "openAi" in n["type"].lower() or "lmChatOpenAi" in n.get("type", "")
        for n in nodes
    )

    if not has_llm_router:
        print(f"  WARNING: No AishaLlmRouter node found!")
        return False
    if has_openai:
        print(f"  WARNING: Still has OpenAI node!")
        return False

    print(f"  AishaLlmRouter: present")

    # Step 1: Deactivate
    print(f"  Step 1: Deactivating...")
    try:
        status = n8n_api_activate(f"/api/v1/workflows/{workflow_id}", False)
        print(f"  -> Deactivated (status={status})")
    except Exception as e:
        print(f"  -> Deactivation note: {e}")

    # Step 2: Update nodes and connections via PUT
    wf_name = local_wf.get("name", os.path.basename(file_path).replace(".json", ""))
    print(f"  Step 2: PUT workflow ({wf_name})...")
    payload = {
        "name": wf_name,
        "nodes": nodes,
        "connections": connections,
        "settings": settings,
    }
    try:
        status_code, body = n8n_api_put(f"/api/v1/workflows/{workflow_id}", payload)
        if status_code == 200:
            print(f"  -> Updated: {wf_name} (status=200)")
        else:
            print(f"  -> ERROR: status={status_code}, body={body[:200]}")
            return False
    except Exception as e:
        print(f"  -> ERROR: {e}")
        return False

    # Step 3: Activate
    print(f"  Step 3: Activating...")
    try:
        status = n8n_api_activate(f"/api/v1/workflows/{workflow_id}", True)
        print(f"  -> Activated (status={status})")
    except Exception as e:
        print(f"  -> Activation note: {e}")

    print(f"  DONE: {os.path.basename(file_path)}")
    return True


def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(base_dir)

    print("Deploying AishaLlmRouter workflows to n8n")
    print(f"Container: {N8N_CONTAINER}")

    # Verify container is running
    result = subprocess.run(
        ["docker", "ps", "--filter", f"name={N8N_CONTAINER}", "--format", "{{.Status}}"],
        capture_output=True, text=True
    )
    if "Up" not in result.stdout:
        print("ERROR: n8n container is not running!")
        sys.exit(1)

    successes = 0
    failures = 0

    for file_path, wf_id in WORKFLOWS.items():
        full_path = os.path.join(base_dir, file_path)
        if not os.path.exists(full_path):
            print(f"ERROR: File not found: {file_path}")
            failures += 1
            continue

        try:
            if deploy_workflow(full_path, wf_id):
                successes += 1
            else:
                failures += 1
        except Exception as e:
            print(f"ERROR deploying {file_path}: {e}")
            failures += 1

    print(f"\n{'='*60}")
    print(f"Results: {successes} success, {failures} failed")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
