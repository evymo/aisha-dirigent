/**
 * Minimal AISHA Auth + PostgREST client for dev test scripts.
 *
 * Drop-in-compatible shim for the small subset of `legacy SDK (removed)`
 * our test harnesses need (admin.createUser, admin.deleteUser,
 * signInWithPassword, from().insert(), rpc). Pure `fetch` — zero runtime
 * dependency on `legacy SDK (removed)`.
 *
 * NOT meant for app code. App code must use `@aisha/api-core`.
 */

const DEFAULT_TIMEOUT_MS = 30_000;

function fetchWithTimeout(url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

function detectServiceRole(jwt) {
  try {
    const [, payload] = jwt.split(".");
    if (!payload) return false;
    const json = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    );
    return json.role === "service_role";
  } catch {
    return false;
  }
}

/**
 * Drop-in-compatible factory for the small subset of legacy-sdk we use.
 *
 * @param {string} baseUrl
 * @param {string} key
 * @param {{global?: {headers?: Record<string,string>}, auth?: unknown}} [options]
 */
export function createClient(baseUrl, key, options) {
  const authUrl = baseUrl.replace(/\/+$/, "") + "/auth/v1";
  const restUrl = baseUrl.replace(/\/+$/, "") + "/rest/v1";
  const providedAuth = options?.global?.headers?.Authorization;
  const isServiceRole = detectServiceRole(key);

  let accessToken = null;
  if (providedAuth && providedAuth.startsWith("Bearer ")) {
    accessToken = providedAuth.slice(7);
  }

  function authHeader() {
    if (accessToken) return { Authorization: `Bearer ${accessToken}` };
    return { Authorization: `Bearer ${key}` };
  }

  return {
    auth: {
      async signInWithPassword({ email, password }) {
        const res = await fetchWithTimeout(`${authUrl}/token?grant_type=password`, {
          method: "POST",
          headers: { apikey: key, "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        if (!res.ok) {
          const body = await res.text();
          return {
            data: { session: null, user: null },
            error: { message: `signIn failed (${res.status}): ${body}` },
          };
        }
        const json = await res.json();
        accessToken = json.access_token;
        return {
          data: {
            session: { access_token: json.access_token, refresh_token: json.refresh_token },
            user: json.user,
          },
          error: null,
        };
      },

      admin: {
        async createUser({ email, password, email_confirm, user_metadata, app_metadata }) {
          if (!isServiceRole) {
            return { data: null, error: { message: "admin.createUser requires service_role key" } };
          }
          const res = await fetchWithTimeout(`${authUrl}/admin/users`, {
            method: "POST",
            headers: {
              apikey: key,
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ email, password, email_confirm, user_metadata, app_metadata }),
          });
          if (!res.ok) {
            const body = await res.text();
            return { data: null, error: { message: `createUser failed (${res.status}): ${body}` } };
          }
          const user = await res.json();
          return { data: { user }, error: null };
        },
        async deleteUser(userId) {
          if (!isServiceRole) {
            return { data: null, error: { message: "admin.deleteUser requires service_role key" } };
          }
          const res = await fetchWithTimeout(
            `${authUrl}/admin/users/${encodeURIComponent(userId)}`,
            {
              method: "DELETE",
              headers: { apikey: key, Authorization: `Bearer ${key}` },
            },
          );
          if (!res.ok) {
            const body = await res.text();
            return { data: null, error: { message: `deleteUser failed (${res.status}): ${body}` } };
          }
          return { data: null, error: null };
        },
      },
    },

    from(table) {
      return {
        async insert(row) {
          const res = await fetchWithTimeout(`${restUrl}/${encodeURIComponent(table)}`, {
            method: "POST",
            headers: {
              apikey: key,
              ...authHeader(),
              "Content-Type": "application/json",
              Prefer: "return=representation",
            },
            body: JSON.stringify(row),
          });
          if (!res.ok) {
            const body = await res.text();
            return {
              data: null,
              error: { message: `insert ${table} failed (${res.status}): ${body}` },
            };
          }
          const data = await res.json();
          return { data, error: null };
        },
      };
    },

    async rpc(fn, args) {
      const res = await fetchWithTimeout(`${restUrl}/rpc/${encodeURIComponent(fn)}`, {
        method: "POST",
        headers: {
          apikey: key,
          ...authHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args ?? {}),
      });
      if (!res.ok) {
        const body = await res.text();
        return { data: null, error: { message: `rpc ${fn} failed (${res.status}): ${body}` } };
      }
      if (res.status === 204) return { data: null, error: null };
      const data = await res.json();
      return { data, error: null };
    },
  };
}
