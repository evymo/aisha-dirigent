#!/usr/bin/env python3
"""
Appsmith API setup script.
Creates datasource + StoryLoop Admin app in local Appsmith instance.

Usage: python3 scripts/appsmith-api-setup.py
"""

import json
import os
import sys
import urllib.request
import urllib.parse
import http.cookiejar

# Credentials come from the environment (cold-start emits APPSMITH_ADMIN_* via
# generate-secrets.mjs). Never hardcode the admin email/password in the repo.
BASE = os.environ.get("APPSMITH_BASE_URL", "http://localhost:8090")
EMAIL = os.environ.get("APPSMITH_ADMIN_EMAIL") or os.environ.get("ADMIN_EMAIL") or "admin@example.com"
PASSWORD = os.environ.get("APPSMITH_ADMIN_PASSWORD")
if not PASSWORD:
    sys.exit("APPSMITH_ADMIN_PASSWORD not set — source .env.coolify (generate-secrets.mjs emits it).")
WS_ID = os.environ.get("APPSMITH_WORKSPACE_ID", "69abf7f68b5c8e4325ca73bd")

# Cookie jar for session management
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(cj),
    urllib.request.HTTPRedirectHandler()
)

def get_xsrf():
    for c in cj:
        if c.name == "XSRF-TOKEN":
            return c.value
    return None

def api_get(path):
    xsrf = get_xsrf()
    req = urllib.request.Request(f"{BASE}{path}")
    if xsrf:
        req.add_header("X-XSRF-TOKEN", xsrf)
    resp = opener.open(req)
    return json.loads(resp.read())

def api_post(path, data, content_type="application/json", expect_json=True):
    xsrf = get_xsrf()
    if content_type == "application/json":
        body = json.dumps(data).encode()
    else:
        body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(f"{BASE}{path}", data=body, method="POST")
    req.add_header("Content-Type", content_type)
    if xsrf:
        req.add_header("X-XSRF-TOKEN", xsrf)
    try:
        resp = opener.open(req)
        raw = resp.read()
    except urllib.error.HTTPError as e:
        raw = e.read()
        if expect_json and raw.strip():
            return json.loads(raw)
        return {"error": True, "status": e.code, "raw": raw[:500].decode("utf-8", errors="replace")}
    if not expect_json:
        return {"url": resp.url, "status": resp.status, "raw": raw[:200]}
    if not raw.strip():
        return {"url": resp.url, "status": resp.status}
    return json.loads(raw)

def login():
    print("=== Logging in ===")
    # Get initial XSRF token
    opener.open(f"{BASE}/api/v1/users/me")
    
    resp = api_post("/api/v1/login", {
        "username": EMAIL,
        "password": PASSWORD
    }, content_type="application/x-www-form-urlencoded", expect_json=False)
    
    # Login returns 302 redirect to /applications on success
    has_session = any(c.name == "SESSION" for c in cj)
    print(f"  Session cookie: {has_session}")
    print(f"  Redirect URL: {resp.get('url', 'N/A')}")
    
    if has_session:
        print("  Login successful!")
        return True
    else:
        print("  Login failed - no SESSION cookie")
        return False

def find_pg_plugin():
    print("=== Finding PostgreSQL plugin ===")
    resp = api_get(f"/api/v1/plugins?workspaceId={WS_ID}")
    for p in resp.get("data", []):
        pkg = p.get("packageName", "")
        if "postgres" in pkg.lower():
            print(f"  Found: {p['name']} (ID: {p['id']})")
            return p["id"]
    print("  ERROR: PostgreSQL plugin not found!")
    return None

def create_datasource(plugin_id):
    print("=== Creating Supabase PostgreSQL datasource ===")
    
    # Check if already exists
    resp = api_get(f"/api/v1/datasources?workspaceId={WS_ID}")
    for ds in resp.get("data", []):
        if ds.get("name") == "Supabase PostgreSQL":
            print(f"  Already exists: {ds['id']}")
            return ds["id"]
    
    ds_config = {
        "connection": {
            "mode": "READ_WRITE"
        },
        "endpoints": [{
            "host": "host.docker.internal",
            "port": 57422
        }],
        "authentication": {
            "authenticationType": "dbAuth",
            "databaseName": "postgres",
            "username": "postgres",
            "password": "postgres"
        },
        "sshProxyEnabled": False
    }
    
    # Appsmith CE uses "unused_env" as default environment ID
    payload = {
        "name": "Supabase PostgreSQL",
        "pluginId": plugin_id,
        "workspaceId": WS_ID,
        "datasourceStorages": {
            "unused_env": {
                "environmentId": "unused_env",
                "datasourceConfiguration": ds_config,
                "isConfigured": True
            }
        }
    }
    
    resp = api_post("/api/v1/datasources", payload)
    
    ds = resp.get("data", {})
    ds_id = ds.get("id")
    invalids = ds.get("invalids", [])
    messages = ds.get("messages", [])
    
    print(f"  Created: {ds_id}")
    if invalids:
        print(f"  Invalids: {invalids}")
    if messages:
        print(f"  Messages: {messages}")
    
    return ds_id

def test_datasource(ds_id):
    print("=== Testing datasource connection ===")
    try:
        resp = api_post(f"/api/v1/datasources/{ds_id}/test", {})
        invalids = resp.get("data", {}).get("invalids", [])
        messages = resp.get("data", {}).get("messages", [])
        
        if not invalids:
            print("  Connection successful!")
            return True
        else:
            print(f"  Connection issues: {invalids}")
            if messages:
                print(f"  Messages: {messages}")
            return False
    except Exception as e:
        print(f"  Test failed: {e}")
        return False

def create_app():
    print("=== Creating StoryLoop Admin app ===")
    
    # Check existing apps
    try:
        resp = api_get(f"/api/v1/applications?workspaceId={WS_ID}")
        for app in resp.get("data", []):
            if "StoryLoop" in app.get("name", ""):
                print(f"  Already exists: {app['name']} (ID: {app['id']})")
                return app["id"]
    except Exception:
        pass
    
    resp = api_post("/api/v1/applications", {
        "name": "StoryLoop Admin",
        "workspaceId": WS_ID,
        "color": "#4F46E5",
        "icon": "line-chart"
    })
    
    app = resp.get("data", {})
    app_id = app.get("id")
    print(f"  Created: {app.get('name')} (ID: {app_id})")
    
    return app_id

def main():
    print(f"\nAppsmith Setup - {BASE}")
    print(f"Workspace: {WS_ID}\n")
    
    if not login():
        print("Login failed!")
        sys.exit(1)
    
    plugin_id = find_pg_plugin()
    if not plugin_id:
        sys.exit(1)
    
    ds_id = create_datasource(plugin_id)
    if not ds_id:
        print("Datasource creation failed!")
        sys.exit(1)
    
    test_datasource(ds_id)
    
    app_id = create_app()
    if not app_id:
        print("App creation failed!")
        sys.exit(1)
    
    print(f"\n=== DONE ===")
    print(f"  Datasource ID: {ds_id}")
    print(f"  App ID: {app_id}")
    print(f"  Open Appsmith: {BASE}/applications")

if __name__ == "__main__":
    main()
