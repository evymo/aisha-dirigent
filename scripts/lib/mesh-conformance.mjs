/**
 * mesh-conformance — THE SINGLE OWNER of "is this stack on the mesh yet".
 *
 * Target shape (owner, 2026-07-30): inbound only through edge, internally
 * everything on the mesh. Both the gate (`mesh-inside-edge-outside`) and the
 * baseline generator read the verdict from HERE.
 *
 * Why one owner: a baseline computed by a second implementation eventually
 * disagrees with the check it exists to serve — and the disagreement reads as
 * migration progress. Same reason `scope_effective` owns the scope rule and
 * `document_visible_to` owns sensitivity: if everyone applies it their own way,
 * everyone is responsible and therefore nobody is.
 *
 * ⚠️ AN AGENT ALONE IS NOT ENOUGH. Measured on a production instance 2026-07-30: `svc-potok`
 * ships a netbird agent in its stack and still has NO route to 100.64.0.0/10 —
 * the agent owns `wt0` inside its OWN namespace and a sibling on the bridge
 * network inherits nothing from it. Every container that can actually use the
 * mesh (mesh-router, core/potok/local-ingest mesh-ingress) shares the agent's
 * namespace. Hence both conditions below.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(join(ROOT, p), "utf-8");
const catalogService = (id) => JSON.parse(read("config/services.json")).services?.[id];

/** Backend services the catalog declares — the universe, DERIVED not listed.
 *  A hand-written universe only ever measures what someone remembered; that is
 *  how `mesh-agent-internal-resolution` stayed green while never seeing ai-chat. */
export function meshServices() {
  const catalog = JSON.parse(read("config/services.json"));
  const out = [];
  for (const [id, s] of Object.entries(catalog.services)) {
    // KRITÉRIUM: služba, kterou někdo uvnitř OSLOVUJE JMÉNEM, musí být jménem
    // dosažitelná — tedy v mesh. Deklaruje to katalog (`internal_url` /
    // `internal_endpoints`), takže se univerzum nepíše ručně.
    //
    // ⛔ DO 2026-08-21 tu stálo `s.placement !== "backend"` a byla to vada
    // měřidla: `placement` říká, na KTERÉM STROJI služba běží, ne jestli se
    // s ní mluví zevnitř. Brána proto nikdy neviděla extranet (frontend),
    // ledger ani exec (experimental) — a extranet přitom edge oslovuje
    // vnitřním jménem, které bez mesh propadlo wildcardem na cizí stroj (502
    // po každém přihlášení). Naopak služby BEZ vnitřní adresy (registry,
    // monitoring) univerzum nafukovaly, aniž by je kdokoli jménem volal.
    // ⛔ DOPLNĚNO 2026-08-22 `internal_tcp_endpoints`: kritérium výš mluví o službě,
    // kterou někdo uvnitř OSLOVUJE JMÉNEM — a to se protokolem nemění. clamd i
    // redis se jménem oslovují (CLAMD_HOST, SHARED_REDIS_HOST), jen ne přes HTTP.
    // Dokud tu ta pole nebyla, univerzum je nevidělo, takže verdikt o nich mlčel
    // a mlčení vypadalo jako čisto — přitom právě ony chodily po SDÍLENÉ síti,
    // kde o jméno soupeří víc nájemníků najednou.
    const vnitrniAdresa =
      Boolean(s.internal_url) ||
      (s.internal_endpoints ?? []).length > 0 ||
      (s.internal_tcp_endpoints ?? []).length > 0;
    if (!vnitrniAdresa) continue;
    const compose = typeof s.compose === "string" ? s.compose : "";
    if (!compose || !existsSync(join(ROOT, compose))) continue;
    out.push({ id, compose });
  }
  return out;
}

/** Stacks that cannot reach the mesh: no agent, or services outside its netns. */
export function nonMeshStacks() {
  return meshServices()
    .filter(({ id, compose }) => {
      const t = read(compose);
      // HOSTITELSKÝ PROVISIONER není účastník mesh. Pozná se vlastností, ne
      // jménem: sáhne na docker.sock a nedeklaruje ŽÁDNOU síť — nic nekonzumuje
      // ani neposkytuje, jen na hostu založí sítě a skončí. Vyžadovat po něm
      // netbird sidecar by znamenalo vyžadovat mesh dřív, než mesh-DNS síť
      // vůbec existuje (tu zakládá právě on).
      if (/docker\.sock/.test(t) && !/^networks:/m.test(t)) return false;
      // PŘEDPOKLAD ENROLLMENTU není účastník mesh. Deklaruje se v katalogu
      // (`mesh_bootstrap_dependency: true` + `_comment_mesh`), ne tady jménem:
      // Keycloak vydává token, bez kterého se žádný peer nezapíše (chicken-and-egg
      // 2026-07-16; majitel 2026-08-19: „kdo Keycloak potřebuje zevnitř, jde
      // napřímo kontejnerovou sítí"). Kdyby brána takový stack počítala, nutila
      // by k tvaru, který mesh rozbije dřív, než vznikne.
      if (catalogService(id)?.mesh_bootstrap_dependency === true) return false;
      const hasAgent = /^\s{2}netbird-agent:/m.test(t);
      const inNamespace = /network_mode:\s*["']?service:netbird-agent["']?/.test(t);
      return !(hasAgent && inNamespace);
    })
    .map(({ id }) => id)
    .sort();
}

/** Composes publishing a PUBLIC host themselves — that is edge's job. */
export function ownPublicRouterOffenders() {
  const out = [];
  for (const f of readdirSync(ROOT)) {
    if (!f.startsWith("docker-compose.coolify") || !f.endsWith(".yml")) continue;
    if (f.includes("prebuilt")) continue; // the edge itself
    const t = read(f);
    for (const m of t.matchAll(/traefik\.http\.routers\.[a-z0-9-]+\.rule\s*[=:]\s*(.+)/gi)) {
      const rule = m[1] ?? "";
      if (/\$\{[A-Z0-9_]*DOMAIN_PUBLIC/.test(rule) || /\$\{EXTRANET_DOMAIN\}/.test(rule)) {
        if (!out.includes(f)) out.push(f);
      }
    }
  }
  return out.sort();
}
