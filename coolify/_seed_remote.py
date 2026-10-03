#!/usr/bin/env python3
"""Seed critical tables on self-hosted Supabase via PostgREST API."""

import json
import os
import sys
import urllib.request
import urllib.error

API = os.environ.get("AISHA_POSTGREST_URL", "").rstrip("/")
SK = os.environ.get("AISHA_POSTGREST_SERVICE_KEY", "")
if not API or not SK:
    sys.exit("ERROR: set AISHA_POSTGREST_URL and AISHA_POSTGREST_SERVICE_KEY env (no committed fallbacks)")
ADMIN_UID = os.environ.get("AISHA_SEED_ADMIN_UID", "2c0e9e86-0719-4f76-8a87-bd97e3541a72")
SEED_UID = "00000000-0000-0000-0000-000000000001"

if not API or not SK:
    sys.exit(
        "Missing required config: set AISHA_POSTGREST_URL and "
        "AISHA_POSTGREST_SERVICE_KEY in the environment before running this seed."
    )

HEADERS = {
    "apikey": SK,
    "Authorization": f"Bearer {SK}",
    "Content-Type": "application/json",
    "Content-Profile": "public",
    "Prefer": "return=representation,resolution=merge-duplicates",
}


def post(table: str, data: list[dict]) -> list[dict]:
    """POST JSON array to PostgREST table, return response."""
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        f"{API}/rest/v1/{table}",
        data=body,
        headers=HEADERS,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
            print(f"  ✓ {table}: {len(result)} rows")
            return result
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()
        print(f"  ✗ {table} HTTP {e.code}: {err_body}", file=sys.stderr)
        # If conflict (409) or already exists, try to continue
        if e.code == 409:
            print(f"    (rows may already exist, continuing...)")
            return []
        raise


def get(table: str, params: str = "") -> list[dict]:
    """GET from PostgREST table."""
    url = f"{API}/rest/v1/{table}"
    if params:
        url += f"?{params}"
    req = urllib.request.Request(url, headers={
        "apikey": SK,
        "Authorization": f"Bearer {SK}",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


# ── 1. Roles ──────────────────────────────────────────────────
print("=== 1. Roles ===")
post("roles", [
    {"name": "admin", "display_name": "Administrator", "description": "Full system access with all privileges", "is_admin": True, "is_system": True, "can_manage_users": True, "can_manage_roles": True, "can_view_phi": True, "can_export_phi": True, "can_break_glass": True},
    {"name": "staff", "display_name": "Staff Member", "description": "Internal team member with elevated access", "is_admin": True, "is_system": True, "can_manage_users": True, "can_manage_roles": False, "can_view_phi": True, "can_export_phi": False, "can_break_glass": False},
    {"name": "practitioner", "display_name": "Practitioner", "description": "Production practitioner with operational access", "is_admin": False, "is_system": True, "can_manage_users": False, "can_manage_roles": False, "can_view_phi": True, "can_export_phi": False, "can_break_glass": False},
    {"name": "partner", "display_name": "Partner", "description": "Certified non-production partner", "is_admin": False, "is_system": True, "can_manage_users": False, "can_manage_roles": False, "can_view_phi": False, "can_export_phi": False, "can_break_glass": False},
    {"name": "member", "display_name": "Member", "description": "Standard platform member", "is_admin": False, "is_system": True, "can_manage_users": False, "can_manage_roles": False, "can_view_phi": False, "can_export_phi": False, "can_break_glass": False},
    {"name": "evaluator", "display_name": "Evaluator", "description": "Study evaluator with access to blinded data", "is_admin": False, "is_system": True, "can_manage_users": False, "can_manage_roles": False, "can_view_phi": True, "can_export_phi": True, "can_break_glass": False},
])

# ── 2. Permissions catalog ────────────────────────────────────
print("\n=== 2. Permissions ===")
post("permissions", [
    {"code": "view_admin_dashboard", "name": "View Admin Dashboard", "description": "Can view admin dashboard", "category": "admin", "is_system": True},
    {"code": "manage_users", "name": "Manage Users", "description": "Can manage users", "category": "admin", "is_system": True},
    {"code": "manage_roles", "name": "Manage Roles", "description": "Can manage roles", "category": "admin", "is_system": True},
    {"code": "manage_permissions", "name": "Manage Permissions", "description": "Can manage permissions", "category": "admin", "is_system": True},
    {"code": "manage_studies", "name": "Manage Studies", "description": "Can manage studies", "category": "admin", "is_system": True},
    {"code": "manage_products", "name": "Manage Products", "description": "Can manage products", "category": "admin", "is_system": True},
    {"code": "manage_orders", "name": "Manage Orders", "description": "Can manage orders", "category": "admin", "is_system": True},
    {"code": "view_audit_logs", "name": "View Audit Logs", "description": "Can view audit logs", "category": "admin", "is_system": True},
    {"code": "manage_system_config", "name": "Manage System Config", "description": "Can manage system configuration", "category": "admin", "is_system": True},
    {"code": "manage_agent_configurations", "name": "Manage AI Agent Configurations", "description": "Create, edit and delete AI agent configurations", "category": "admin", "is_system": False},
    {"code": "view_staff_dashboard", "name": "View Staff Dashboard", "description": "Can view staff dashboard", "category": "staff", "is_system": True},
    {"code": "process_orders", "name": "Process Orders", "description": "Can process orders", "category": "staff", "is_system": True},
    {"code": "view_basic_reports", "name": "View Basic Reports", "description": "Can view basic reports", "category": "staff", "is_system": True},
    {"code": "view_studies", "name": "View Studies", "description": "Can view available studies", "category": "member", "is_system": True},
    {"code": "enroll_studies", "name": "Enroll in Studies", "description": "Can enroll in studies", "category": "member", "is_system": True},
    {"code": "submit_checkins", "name": "Submit Check-ins", "description": "Can submit health check-ins", "category": "member", "is_system": True},
    {"code": "upload_documents", "name": "Upload Documents", "description": "Can upload health documents", "category": "member", "is_system": True},
    {"code": "view_products", "name": "View Products", "description": "Can view products", "category": "shop", "is_system": True},
    {"code": "preorder_products", "name": "Preorder Products", "description": "Can preorder products", "category": "shop", "is_system": True},
    {"code": "order_products", "name": "Order Products", "description": "Can order products", "category": "shop", "is_system": True},
    {"code": "auto_approve_orders", "name": "Auto Approve Orders", "description": "Orders are auto-approved", "category": "shop", "is_system": True},
    {"code": "view_phi", "name": "View sensitive data", "description": "Can view protected health information", "category": "phi", "is_system": True},
    {"code": "edit_phi", "name": "Edit sensitive data", "description": "Can edit protected health information", "category": "phi", "is_system": True},
    {"code": "share_phi", "name": "Share sensitive data", "description": "Can share protected health information", "category": "phi", "is_system": True},
    {"code": "view_partner_dashboard", "name": "View Partner Dashboard", "description": "Can view partner dashboard", "category": "partner", "is_system": True},
    {"code": "view_assigned_members", "name": "View Assigned Members", "description": "Can view assigned members", "category": "partner", "is_system": True},
    {"code": "manage_member_assignments", "name": "Manage Member Assignments", "description": "Can manage member assignments", "category": "partner", "is_system": True},
    {"code": "schedule_appointments", "name": "Schedule Appointments", "description": "Can schedule appointments", "category": "partner", "is_system": True},
    {"code": "send_member_messages", "name": "Send Member Messages", "description": "Can send messages to members", "category": "partner", "is_system": True},
    {"code": "view_member_progress", "name": "View Member Progress", "description": "Can view member progress", "category": "partner", "is_system": True},
    {"code": "view_operational_details", "name": "View Operational Details", "description": "Can view operational details", "category": "partner_pro", "is_system": True},
    {"code": "create_operational_notes", "name": "Create Operational Notes", "description": "Can create operational notes", "category": "partner_pro", "is_system": True},
    {"code": "issue_recommendations", "name": "Issue Recommendations", "description": "Can issue recommendations", "category": "partner_pro", "is_system": True},
    {"code": "access_lab_interpretations", "name": "Access Lab Interpretations", "description": "Can access lab interpretations", "category": "partner_pro", "is_system": True},
    {"code": "prescribe_protocols", "name": "Prescribe Protocols", "description": "Can prescribe protocols", "category": "partner_pro", "is_system": True},
    {"code": "view_basic_health_summary", "name": "View Basic Health Summary", "description": "Can view basic health summary", "category": "partner_amateur", "is_system": True},
    {"code": "create_wellness_notes", "name": "Create Wellness Notes", "description": "Can create wellness notes", "category": "partner_amateur", "is_system": True},
    {"code": "suggest_lifestyle_changes", "name": "Suggest Lifestyle Changes", "description": "Can suggest lifestyle changes", "category": "partner_amateur", "is_system": True},
    {"code": "evaluate_health_data", "name": "Evaluate Health Data", "description": "Can evaluate health data", "category": "evaluator", "is_system": True},
    {"code": "create_assessments", "name": "Create Assessments", "description": "Can create assessments", "category": "evaluator", "is_system": True},
])

# ── 3. Supported languages ───────────────────────────────────
print("\n=== 3. Supported Languages ===")
post("supported_languages", [
    {"code": "cs", "name_native": "Čeština", "name_key": "languages.cs.name", "is_active": True, "is_default": True, "sort_order": 1},
    {"code": "en", "name_native": "English", "name_key": "languages.en.name", "is_active": True, "is_default": False, "sort_order": 2},
    {"code": "de", "name_native": "Deutsch", "name_key": "languages.de.name", "is_active": True, "is_default": False, "sort_order": 3},
    {"code": "fr", "name_native": "Français", "name_key": "languages.fr.name", "is_active": True, "is_default": False, "sort_order": 4},
    {"code": "ru", "name_native": "Русский", "name_key": "languages.ru.name", "is_active": True, "is_default": False, "sort_order": 5},
    {"code": "th", "name_native": "ไทย", "name_key": "languages.th.name", "is_active": True, "is_default": False, "sort_order": 6},
])

# ── 4. Role-section permissions ───────────────────────────────
print("\n=== 4. Role-Section Permissions ===")
admin_sections = [
    "overview", "members", "roles", "consultants", "partners", "studies",
    "registrations", "contributions", "outcomes", "archive", "products",
    "production", "test_questions", "questionnaires", "translations",
    "biomarker_ranges", "orders", "subscriptions", "packages", "tokenomics",
]
role_perms: list[dict] = []

# Admin: all sections, read+write
for s in admin_sections:
    role_perms.append({"role": "admin", "section": s, "permission": "read"})
    role_perms.append({"role": "admin", "section": s, "permission": "write"})

# Staff
for s in ["overview", "members", "studies", "registrations", "archive", "products", "orders"]:
    role_perms.append({"role": "staff", "section": s, "permission": "read"})
    role_perms.append({"role": "staff", "section": s, "permission": "write"})
for s in ["contributions", "outcomes", "subscriptions", "consultants", "partners"]:
    role_perms.append({"role": "staff", "section": s, "permission": "read"})

# Practitioner
for s in ["overview", "studies", "registrations", "outcomes", "products", "archive"]:
    role_perms.append({"role": "practitioner", "section": s, "permission": "read"})

# Member
for s in ["products", "studies", "archive"]:
    role_perms.append({"role": "member", "section": s, "permission": "read"})

# Evaluator
for s in ["studies", "registrations", "outcomes", "contributions"]:
    role_perms.append({"role": "evaluator", "section": s, "permission": "read"})

post("role_permissions", role_perms)

# ── 5. App role permissions (role → permission_id grants) ─────
print("\n=== 5. App Role Permissions ===")

# Fetch all permission IDs
perms = get("permissions", "select=id,code")
perm_map = {p["code"]: p["id"] for p in perms}
print(f"  Found {len(perm_map)} permissions")

grants: list[dict] = []

# Admin gets ALL permissions
for code, pid in perm_map.items():
    grants.append({"role": "admin", "permission_id": pid, "granted_by": ADMIN_UID})

# Staff
for code in ["view_staff_dashboard", "process_orders", "view_basic_reports", "manage_orders", "view_products", "view_studies"]:
    if code in perm_map:
        grants.append({"role": "staff", "permission_id": perm_map[code], "granted_by": ADMIN_UID})

# Member
for code in ["view_studies", "enroll_studies", "submit_checkins", "upload_documents", "view_products", "order_products"]:
    if code in perm_map:
        grants.append({"role": "member", "permission_id": perm_map[code], "granted_by": ADMIN_UID})

# Practitioner
for code in ["view_partner_dashboard", "view_assigned_members", "manage_member_assignments",
             "schedule_appointments", "send_member_messages", "view_member_progress",
             "view_operational_details", "create_operational_notes", "issue_recommendations",
             "access_lab_interpretations", "prescribe_protocols"]:
    if code in perm_map:
        grants.append({"role": "practitioner", "permission_id": perm_map[code], "granted_by": ADMIN_UID})

# Partner
for code in ["view_partner_dashboard", "view_assigned_members", "view_member_progress",
             "schedule_appointments", "send_member_messages",
             "view_basic_health_summary", "create_wellness_notes", "suggest_lifestyle_changes"]:
    if code in perm_map:
        grants.append({"role": "partner", "permission_id": perm_map[code], "granted_by": ADMIN_UID})

# Evaluator
for code in ["evaluate_health_data", "create_assessments"]:
    if code in perm_map:
        grants.append({"role": "evaluator", "permission_id": perm_map[code], "granted_by": ADMIN_UID})

post("app_role_permissions", grants)

# ── 6. Verify ─────────────────────────────────────────────────
print("\n=== Verification ===")
for table in ["roles", "permissions", "role_permissions", "app_role_permissions", "supported_languages"]:
    rows = get(table, "select=id&limit=1000")
    print(f"  {table}: {len(rows)} rows")

# Test get_user_permissions for admin user
print("\n=== Testing get_user_permissions RPC ===")
req = urllib.request.Request(
    f"{API}/rest/v1/rpc/get_user_permissions",
    data=json.dumps({"p_user_id": ADMIN_UID}).encode(),
    headers={
        "apikey": SK,
        "Authorization": f"Bearer {SK}",
        "Content-Type": "application/json",
    },
    method="POST",
)
try:
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
        print(f"  Admin permissions: {len(result)} items")
        if result:
            codes = [r.get("permission_code") or r.get("code") or str(r) for r in result[:5]]
            print(f"  Sample: {codes}")
        else:
            print("  ⚠ Still empty — check get_user_permissions function")
except urllib.error.HTTPError as e:
    err = e.read().decode()
    print(f"  RPC error {e.code}: {err}")

print("\n✅ Seed complete! Re-login in the browser to load new permissions.")
