/**
 * Edge Function: keycloak-role-sync
 *
 * Synchronizes Keycloak realm roles based on app_role_permissions changes.
 * Called by DB trigger (fn_sync_keycloak_roles) when admin_tools permissions
 * are granted or revoked in the Dirigent admin panel.
 *
 * Flow:
 *   1. Admin toggles access_studio/access_n8n permission for a role
 *   2. DB trigger fires → net.http_post → this function
 *   3. Function authenticates to Keycloak Admin API
 *   4. Finds all Keycloak users with the affected app_role
 *   5. Assigns or removes the corresponding KC realm role
 *
 * Permission → KC Realm Role mapping:
 *   access_studio → studio_access
 *   access_n8n    → n8n_access
 *
 * Environment:
 *   - KEYCLOAK_URL              (e.g. http://keycloak:8080 or https://keycloak.id3a.cz)
 *   - KEYCLOAK_ADMIN            (admin username)
 *   - KEYCLOAK_ADMIN_PASSWORD   (admin password)
 *   - KEYCLOAK_REALM            (default: evymo)
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *
 * @module
 */

import { serve, createClient } from "../_shared/deps.ts";
import { safeLog } from "../_shared/safeLogger.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PERMISSION_TO_KC_ROLE: Record<string, string> = {
  access_studio: "studio_access",
  access_n8n: "n8n_access",
};

const KEYCLOAK_REALM = Deno.env.get("KEYCLOAK_REALM") ?? "evymo";

// ---------------------------------------------------------------------------
// Keycloak Admin API helpers
// ---------------------------------------------------------------------------

async function getKeycloakAdminToken(keycloakUrl: string): Promise<string> {
  const tokenUrl = `${keycloakUrl}/realms/master/protocol/openid-connect/token`;
  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: Deno.env.get("KEYCLOAK_ADMIN") ?? "",
      password: Deno.env.get("KEYCLOAK_ADMIN_PASSWORD") ?? "",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`KC admin token failed: ${resp.status} ${text}`);
  }
  const data = await resp.json();
  return data.access_token as string;
}

async function getRealmRole(
  keycloakUrl: string,
  token: string,
  roleName: string,
): Promise<{ id: string; name: string }> {
  const resp = await fetch(
    `${keycloakUrl}/admin/realms/${KEYCLOAK_REALM}/roles/${encodeURIComponent(roleName)}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
  );
  if (!resp.ok) {
    throw new Error(`KC role lookup failed: ${resp.status} ${roleName}`);
  }
  return resp.json();
}

async function assignRealmRole(
  keycloakUrl: string,
  token: string,
  userId: string,
  role: { id: string; name: string },
): Promise<void> {
  const resp = await fetch(
    `${keycloakUrl}/admin/realms/${KEYCLOAK_REALM}/users/${userId}/role-mappings/realm`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{ id: role.id, name: role.name }]),
      signal: AbortSignal.timeout(10_000),
    },
  );
  // 204 = success, 409 = already assigned (both OK)
  if (!resp.ok && resp.status !== 409) {
    throw new Error(`KC role assign failed: ${resp.status} user=${userId}`);
  }
}

async function removeRealmRole(
  keycloakUrl: string,
  token: string,
  userId: string,
  role: { id: string; name: string },
): Promise<void> {
  const resp = await fetch(
    `${keycloakUrl}/admin/realms/${KEYCLOAK_REALM}/users/${userId}/role-mappings/realm`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{ id: role.id, name: role.name }]),
      signal: AbortSignal.timeout(10_000),
    },
  );
  // 204 = success, 404 = not assigned (both OK)
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`KC role remove failed: ${resp.status} user=${userId}`);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Auth: only accept internal calls with service_role key
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey || !authHeader.includes(serviceKey)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let payload: {
    action: string;
    role: string;
    permission_code: string;
  };
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { action, role, permission_code } = payload;

  // Only sync known admin_tools permissions
  const kcRoleName = PERMISSION_TO_KC_ROLE[permission_code];
  if (!kcRoleName) {
    return new Response(
      JSON.stringify({ ok: true, skipped: true, reason: "unknown permission" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const keycloakUrl = Deno.env.get("KEYCLOAK_URL");
  if (!keycloakUrl) {
    safeLog("error", "keycloak-role-sync.missing-keycloak-url");
    return new Response(
      JSON.stringify({ error: "KEYCLOAK_URL not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) {
    safeLog("error", "keycloak-role-sync.missing-supabase-url");
    return new Response(
      JSON.stringify({ error: "SUPABASE_URL not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    // 1. Authenticate to Keycloak Admin API
    const token = await getKeycloakAdminToken(keycloakUrl);

    // 2. Get the KC realm role representation (need id + name)
    const kcRole = await getRealmRole(keycloakUrl, token, kcRoleName);

    // 3. Find all users with the affected app_role + their Keycloak IDs
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: kcUsers, error: rpcErr } = await supabase.rpc(
      "get_keycloak_ids_for_role",
      { p_role: role },
    );

    if (rpcErr) {
      throw new Error(`RPC get_keycloak_ids_for_role failed: ${rpcErr.message}`);
    }

    if (!kcUsers || kcUsers.length === 0) {
      safeLog("info", "keycloak-role-sync.no-users", `No KC users for role=${role}`);
      return new Response(
        JSON.stringify({ ok: true, affected: 0, role, permission_code }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // 4. Assign or remove KC realm role for each user
    const fn = action === "grant" ? assignRealmRole : removeRealmRole;
    const results: { keycloak_id: string; ok: boolean; error?: string }[] = [];

    for (const u of kcUsers as { user_id: string; keycloak_id: string }[]) {
      try {
        await fn(keycloakUrl, token, u.keycloak_id, kcRole);
        results.push({ keycloak_id: u.keycloak_id, ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        safeLog("warn", "keycloak-role-sync.user-failed", msg);
        results.push({ keycloak_id: u.keycloak_id, ok: false, error: msg });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;

    safeLog(
      "info",
      "keycloak-role-sync.done",
      `action=${action} role=${role} permission=${permission_code} kcRole=${kcRoleName} succeeded=${succeeded} failed=${failed}`,
    );

    return new Response(
      JSON.stringify({
        ok: failed === 0,
        action,
        role,
        permission_code,
        kc_role: kcRoleName,
        succeeded,
        failed,
      }),
      {
        status: failed > 0 ? 207 : 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    safeLog("error", "keycloak-role-sync.fatal", msg);
    return new Response(
      JSON.stringify({ error: "Keycloak sync failed", detail: msg }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
});
