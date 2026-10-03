#!/usr/bin/env node
/**
 * provision-credentials.mjs — deklarativní správa pověření n8n z env.
 *
 * Workflowy (n8n/workflows/*.json) odkazují na pověření JMÉNEM (deploy-workflows
 * je přemapuje na id podle mapy, kterou tenhle skript zapíše). Tohle je JEDINÝ
 * zakladatel pověření platformy — deploy-workflows už žádná nezakládá.
 *
 * ⛔ NAMĚŘENO 2026-09-18 (guru, n8n 1.79.0): veřejné API pověření nevypíše
 * (`GET /api/v1/credentials` → 405). Skript na výpisu padal a nevzniklo nic;
 * deploy-workflows výpis přeskočil a zakládal pověření při každém nasazení
 * znovu (Anthropic API ×2, Forgejo API ×2). Proto se pracuje přes interní REST
 * se session vlastníka (relace-vlastnika.mjs):
 *   · chybí            → založí,
 *   · existuje jedno   → UPRAVÍ na hodnoty z env (rotace se tak propíše),
 *   · víc stejných     → ponechá nejnovější, ostatní smaže, pokud na ně žádný
 *                        workflow neodkazuje (jinak je nahlásí — po přemapování
 *                        je smaže příští nasazení).
 * Hodnoty tajemství se nikdy nelogují.
 *
 * Usage (v n8n-workflow-init; entrypoint dosazuje N8N_API_KEY):
 *   N8N_URL=… N8N_API_KEY=… N8N_BOOTSTRAP_OWNER_EMAIL=… N8N_BOOTSTRAP_OWNER_PASSWORD=… \
 *   N8N_POVERENI_MAPA=/run/n8n/povereni.json node scripts/n8n/provision-credentials.mjs [--dry-run]
 *
 * NOT provisioned (documented gap):
 *   - aishaAdminBridgeApi "AISHA Admin Bridge": the credential CLASS does not
 *     exist in packages/n8n-nodes-aisha/credentials/ (tracked separately).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isDirectRun } from "../lib/cli-entry.mjs";
import { hesloVlastnika, prihlasVlastnika, restKlient } from "./relace-vlastnika.mjs";
import { porovnej } from "../lib/razeni.mjs";

const env = (name) => {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : null;
};

/**
 * Desired credentials: (name, type) identity → data builder + required envs.
 *
 * `platforma: true` = vstupy generuje nebo odvozuje sama platforma (cold-start,
 * bootstrap klíče). Jejich chybění není „volitelný klíč třetí strany“, ale vada
 * doručení — skript ho proto hlásí jako SELHÁNÍ, ne jako tichý skip.
 */
export const DESIRED = [
  {
    name: "AISHA PostgREST",
    type: "aishaPostgrestApi",
    platforma: true,
    // ⛔ NAMĚŘENO 2026-09-18 (guru): uzly n8n-nodes-aisha skládají
    // `${postgrestUrl}/rest/v1/rpc/…` — to obsluhuje GATEWAY (200), přímý
    // PostgREST na :3000 vrací 404. Dřív tu stál přímý PostgREST s pevnou
    // zálohou `http://postgrest:3000` a deploy-workflows zakládal totéž pověření
    // s adresou gateway — dvě hodnoty jednoho pověření. Adresa je gateway.
    needs: ["POSTGREST_SERVICE_TOKEN", "AISHA_POSTGREST_URL"],
    data: () => ({
      postgrestUrl: env("AISHA_POSTGREST_URL"),
      serviceRoleKey: env("POSTGREST_SERVICE_TOKEN"),
      anonKey: env("ANON_KEY") ?? "",
    }),
  },
  {
    name: "AISHA Gateway (Service Role)",
    type: "httpHeaderAuth",
    platforma: true,
    needs: ["POSTGREST_SERVICE_TOKEN"],
    // Must be the Authorization header: every consumer of this credential
    // authenticates via `Authorization: Bearer <POSTGREST_SERVICE_TOKEN>` —
    // PostgREST behind /rest/v1 reads only Authorization (the gateway passes
    // an `apikey` header through untouched and PostgREST ignores it, so the
    // request runs as anon), /functions/v1 forwards only req.headers
    // .authorization to the target service, and direct service calls
    // verify via @aisha/security verifyServiceRole,
    // which parses the Authorization header. An `apikey`-shaped credential
    // authenticates NOTHING on any of those paths — workflows fail 401/anon
    // on every scheduled tick while n8n reports the node as executed
    // (onError: continueRegularOutput).
    // NOTE (already-provisioned instances): this script is create-only; if an
    // older apikey-shaped credential exists under this name, delete it in n8n
    // and re-run the script.
    data: () => ({ name: "Authorization", value: `Bearer ${env("POSTGREST_SERVICE_TOKEN")}` }),
  },
  {
    // Shared-secret guarding all non-public n8n webhook triggers (N8N-04).
    // The webhook nodes set authentication="headerAuth" and reference this
    // credential by name; callers present the header, n8n validates it.
    name: "AISHA Webhook Auth",
    type: "httpHeaderAuth",
    platforma: true,
    needs: ["N8N_WEBHOOK_AUTH_TOKEN"],
    data: () => ({ name: "x-aisha-webhook-token", value: env("N8N_WEBHOOK_AUTH_TOKEN") }),
  },
  {
    name: "OpenAi account",
    type: "openAiApi",
    needs: ["OPENAI_API_KEY"],
    data: () => ({ apiKey: env("OPENAI_API_KEY") }),
  },
  {
    name: "Anthropic account",
    type: "anthropicApi",
    needs: ["ANTHROPIC_API_KEY"],
    data: () => ({ apiKey: env("ANTHROPIC_API_KEY") }),
  },
  {
    name: "Anthropic API",
    type: "httpHeaderAuth",
    needs: ["ANTHROPIC_API_KEY"],
    data: () => ({ name: "x-api-key", value: env("ANTHROPIC_API_KEY") }),
  },
  {
    name: "Google Gemini(PaLM) Api account",
    type: "googlePalmApi",
    needs: ["GOOGLE_AI_API_KEY"],
    data: () => ({
      host: "https://generativelanguage.googleapis.com",
      apiKey: env("GOOGLE_AI_API_KEY"),
    }),
  },
  {
    name: "Forgejo API",
    type: "aishaForgejoApi",
    needs: ["FORGEJO_URL", "FORGEJO_API_TOKEN"],
    data: () => ({ baseUrl: env("FORGEJO_URL"), apiToken: env("FORGEJO_API_TOKEN") }),
  },
  {
    name: "Forgejo API",
    type: "httpHeaderAuth",
    needs: ["FORGEJO_API_TOKEN"],
    data: () => ({ name: "Authorization", value: `token ${env("FORGEJO_API_TOKEN")}` }),
  },
  {
    name: "Forgejo API Token",
    type: "httpHeaderAuth",
    needs: ["FORGEJO_API_TOKEN"],
    data: () => ({ name: "Authorization", value: `token ${env("FORGEJO_API_TOKEN")}` }),
  },
  {
    name: "GitHub account",
    type: "githubApi",
    needs: ["GITHUB_API_TOKEN"],
    data: () => ({ server: "https://api.github.com", user: "", accessToken: env("GITHUB_API_TOKEN") }),
  },
  {
    name: "AISHA Langfuse",
    type: "aishaLangfuseApi",
    needs: ["LANGFUSE_HOST", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"],
    data: () => ({
      host: env("LANGFUSE_HOST"),
      publicKey: env("LANGFUSE_PUBLIC_KEY"),
      secretKey: env("LANGFUSE_SECRET_KEY"),
    }),
  },
  {
    name: "Langfuse API",
    type: "aishaLangfuseApi",
    needs: ["LANGFUSE_HOST", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"],
    data: () => ({
      host: env("LANGFUSE_HOST"),
      publicKey: env("LANGFUSE_PUBLIC_KEY"),
      secretKey: env("LANGFUSE_SECRET_KEY"),
    }),
  },
  {
    name: "AISHA NocoDB",
    type: "aishaNocoDbApi",
    needs: ["NOCODB_URL", "NOCODB_API_TOKEN"],
    data: () => ({ baseUrl: env("NOCODB_URL"), apiToken: env("NOCODB_API_TOKEN") }),
  },
  {
    // OpenClaw adapter (WF_OPENCLAW_NOTIFY, WF_OPENCLAW_SANDBOX_RUNNER): sdílený
    // bearer, který generate-secrets vydává a svc-ai-chat/openclaw už čtou.
    name: "OpenClaw API",
    type: "httpHeaderAuth",
    platforma: true,
    needs: ["OPENCLAW_API_KEY"],
    data: () => ({ name: "Authorization", value: `Bearer ${env("OPENCLAW_API_KEY")}` }),
  },
  {
    // RabbitMQ Trigger (WF_BLOCKCHAIN_SYNC, WF_PIPELINE_EXECUTOR). Adresu
    // odvozuje topologie (integration-mesh-tcp), pověření doručuje cold-start —
    // stejné vstupy, ze kterých n8n skládá RABBITMQ_URL.
    name: "RabbitMQ",
    type: "rabbitmq",
    needs: ["RABBITMQ_HOST", "RABBITMQ_PORT", "RABBITMQ_USER", "RABBITMQ_PASS"],
    data: () => ({
      hostname: env("RABBITMQ_HOST"),
      port: Number(env("RABBITMQ_PORT")),
      username: env("RABBITMQ_USER"),
      password: env("RABBITMQ_PASS"),
      vhost: "/",
      ssl: false,
    }),
  },
  {
    name: "n8n API Key",
    type: "httpHeaderAuth",
    platforma: true,
    needs: ["N8N_API_KEY"],
    data: () => ({ name: "X-N8N-API-KEY", value: env("N8N_API_KEY") }),
  },
];

const identita = (c) => `${c.type}::${c.name}`;

/**
 * Srovná pověření v n8n s `desired`.
 * @param {{ klient: { get: Function, post: Function, patch: Function, smaz: Function },
 *           desired: typeof DESIRED, odkazovana?: Set<string>, dryRun?: boolean }} o
 * @returns {Promise<{ vytvoreno: number, upraveno: number, preskoceno: number, smazano: number,
 *           selhala: string[], odlozeneDuplicity: string[], mapa: Record<string, string> }>}
 */
export async function srovnejPovereni({ klient, desired, odkazovana = new Set(), dryRun = false }) {
  const existujici = (await klient.get("/credentials")) ?? [];
  const podleIdentity = new Map();
  for (const c of existujici) {
    const k = identita(c);
    podleIdentity.set(k, [...(podleIdentity.get(k) ?? []), c]);
  }

  const vysledek = { vytvoreno: 0, upraveno: 0, preskoceno: 0, smazano: 0, selhala: [], odlozeneDuplicity: [], mapa: {} };
  /**
   * ⛔ NAMĚŘENO 2026-09-17 (guru): první neúspěch dřív zastavil celý skript —
   * nevzniklo ANI JEDNO z dalších pověření. Selhání jednoho proto nesmí zastavit
   * ostatní; skript zkusí všechna a selže až na konci, se seznamem.
   */
  for (const cred of desired) {
    const k = identita(cred);
    const chybi = cred.needs.filter((n) => !env(n));
    if (chybi.length > 0) {
      if (cred.platforma) {
        console.error(`❌ "${cred.name}" [${cred.type}] — chybí env, které doručuje platforma: ${chybi.join(", ")}`);
        vysledek.selhala.push(k);
      } else {
        console.warn(`⚠️  skip "${cred.name}" [${cred.type}] — missing env: ${chybi.join(", ")}`);
        vysledek.preskoceno++;
        // null = volitelné pověření záměrně nezaložené (chybí klíč třetí strany):
        // deploy-workflows workflow nahraje, ale neaktivuje — není to selhání nasazení.
        vysledek.mapa[k] = null;
      }
      continue;
    }
    // Nejnovější napřed: ten zůstává, starší kopie jsou kandidáti na smazání.
    const kopie = [...(podleIdentity.get(k) ?? [])].sort((a, b) => porovnej(String(b.createdAt), String(a.createdAt)));
    try {
      if (dryRun) {
        console.log(`(dry-run) ${kopie.length ? "would update" : "would create"} "${cred.name}" [${cred.type}]`);
        continue;
      }
      const telo = { name: cred.name, type: cred.type, data: cred.data() };
      let id;
      if (kopie.length === 0) {
        id = (await klient.post("/credentials", telo)).id;
        console.log(`✨ created "${cred.name}" [${cred.type}]`);
        vysledek.vytvoreno++;
      } else {
        id = kopie[0].id;
        await klient.patch(`/credentials/${id}`, telo);
        vysledek.upraveno++;
      }
      vysledek.mapa[k] = id;
      for (const stara of kopie.slice(1)) {
        if (odkazovana.has(stara.id)) {
          vysledek.odlozeneDuplicity.push(`${k} (${stara.id})`);
          continue;
        }
        await klient.smaz(`/credentials/${stara.id}`);
        console.log(`🧹 removed duplicate "${cred.name}" [${cred.type}] (${stara.id})`);
        vysledek.smazano++;
      }
    } catch (error) {
      console.error(`❌ "${cred.name}" [${cred.type}] — ${error instanceof Error ? error.message : String(error)}`);
      vysledek.selhala.push(k);
    }
  }
  return vysledek;
}

/** Id pověření, na která odkazuje některý workflow (veřejné API vrací i uzly). */
async function odkazovanaPovereni(n8nUrl, apiKey) {
  const ids = new Set();
  let cursor;
  do {
    const res = await fetch(`${n8nUrl}/api/v1/workflows?limit=250${cursor ? `&cursor=${cursor}` : ""}`, {
      headers: { "X-N8N-API-KEY": apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`GET /api/v1/workflows → ${res.status}`);
    const page = await res.json();
    for (const w of page.data ?? []) {
      for (const n of w.nodes ?? []) for (const ref of Object.values(n.credentials ?? {})) if (ref?.id) ids.add(ref.id);
    }
    cursor = page.nextCursor ?? null;
  } while (cursor);
  return ids;
}

if (isDirectRun(import.meta.url)) {
  const { N8N_URL, requireN8nApiKey } = await import("../lib/env.mjs");
  const rest = String(N8N_URL).replace(/\/+$/, "");
  const email = env("N8N_BOOTSTRAP_OWNER_EMAIL");
  if (!email) {
    console.error("❌ N8N_BOOTSTRAP_OWNER_EMAIL chybí — bez vlastníka nelze pověření vypsat ani upravit");
    process.exit(1);
  }
  const cookie = await prihlasVlastnika({ rest, email, heslo: hesloVlastnika(env("N8N_BOOTSTRAP_OWNER_PASSWORD")) });
  const odkazovana = await odkazovanaPovereni(rest, requireN8nApiKey());
  const v = await srovnejPovereni({
    klient: restKlient({ rest, cookie }),
    desired: DESIRED,
    odkazovana,
    dryRun: process.argv.includes("--dry-run"),
  });

  const mapaCesta = env("N8N_POVERENI_MAPA");
  if (mapaCesta) {
    mkdirSync(dirname(mapaCesta), { recursive: true });
    writeFileSync(mapaCesta, JSON.stringify(v.mapa), { mode: 0o600 });
  }
  console.log(
    `done: ${v.vytvoreno} created, ${v.upraveno} already present, ${v.preskoceno} skipped (missing env), ${v.selhala.length} failed`,
  );
  console.log(`upraveno ${v.upraveno}, smazáno duplicit ${v.smazano}, mapa ${Object.keys(v.mapa).length} pověření`);
  if (v.odlozeneDuplicity.length > 0) {
    console.warn(`⚠️  duplicity s odkazem z workflowu (smaže je příští nasazení): ${v.odlozeneDuplicity.join(", ")}`);
  }
  if (v.preskoceno > 0) {
    console.warn("Some credentials were skipped — the workflows referencing them will fail until the env is provided and this script re-runs.");
  }
  if (v.selhala.length > 0) {
    console.error(`SELHALO ${v.selhala.length} pověření: ${v.selhala.join(", ")}`);
    process.exitCode = 1;
  }
}
