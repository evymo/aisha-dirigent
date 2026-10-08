# Full-repo audit + plán postupu A–Z

> Datum: 2026-07-07 (rev. 2026-07-08) · Větev: `docs/krmic-accounting-integration` · Rozsah: NetBird, OpenClaw, deployment, backend, extensions, testy, web + mobil
> Metoda: 6 paralelních hloubkových auditů, klíčové nálezy ověřeny přímo proti kódu (file:line + citace).
>
> **Changelog rev. 2026-07-08:** C3 (Signal port) ověřen proti NetBird docs/issue tracker → **přeřazen na pravděpodobný false positive** (neopravovat). H-N3 (persistence identity peerů) ověřen a **oprava aplikována** do 3 compose souborů. Viz `docs/deploy/MESH_CUTOVER_RUNBOOK.md`.

---

## 0. Executive summary

Platforma je **inženýrsky vyspělá** — defense-in-depth (SSRF guardy, constant-time compare, krátkodobé mintované tokeny, RLS téměř všude, race-safe job claiming, žádná shell/SQL injection), silná unit/gate vrstva (~5,4k unit + ~2,5k gate checků), deploy s wave-orderingem a env-sync. **Žádné committnuté secrets** v repu (`.env.coolify`, `.env-prod-backup*` sedí lokálně, jsou v `.gitignore`).

Problém není nekvalitní kód — jsou to **trust-boundary / authorizační mezery** a **rozjeté kontrakty** (compose slibuje víc, než kód dělá; `.env.example` neodpovídá kódu; „self-healing" komponenty jsou no-op). A jeden systémový: **mesh data-plane reálně neběží** (`MESH_ENABLED=false` je defaultní „stabilní stav").

### Verdikt po komponentách

| Komponenta | Stav | Hlavní důvod |
|---|---|---|
| Backend (services/, SQL) | 🟠 Amber | Solidní, ale 2 Critical authz mezery + over-exposed `anon`/`authenticated` granty |
| NetBird mesh | 🟠 Amber (data-plane) / 🟢 control-plane | Identita peerů přes restart (opraveno), relay identita, coturn/TURN. Signal port = false positive |
| Deployment (Coolify compose) | 🟠 Amber | Rozjeté kontrakty (OpenClaw env, pki-renewer, edge volume) |
| OpenClaw | 🔴 Red (funkčně) | Plánovač si SSRF-blokuje vlastní gateway → každý plan → `manual_review` |
| Extensions | 🟢 Green (kód) / 🟠 CI | Kód čistý; 1 webview CSP/postMessage nález; CI lane nic nebuildí |
| Testovací flow | 🟠 Amber (6.5/10) | Unit/gate silné; 99 Playwright speců neběží v CI, coverage/supply-chain „theater" |
| Web frontend (src/) | 🟢 B+ | Čistý XSS posture; drift: 1 mrtvý endpoint, 2 hooky obchází API klient |
| Mobilní app | 🟢 Nejzdravější | Tokeny v SecureStore, čisté TODO, build/ mimo git; 1 nález zrcadlí web |

---

## 1. CRITICAL — opravit jako první

### C1 · svc-agent-runner `/runs`: kterýkoli přihlášený tenant → RCE na hostu
`services/svc-agent-runner/src/routes/runs.ts:59-67` + `backends/claude-cli.ts:250`

`verifyToken` ověří jen platný realm JWT — **žádná role/scope kontrola** na `POST /runs`, `GET /runs`, `GET /runs/:id`, `cancel`. Image od volajícího se použije bez validace:
```ts
const user = await verifyToken(req.headers.authorization);   // jen authN, žádná role
const image = body.image || (isClaude ? config.agentClaudeImage : '');
// → dockerJSON('POST', '/containers/create', { Image: input.image, ... })
```
Libovolný přihlášený uživatel spustí libovolný image na hostu s Docker socketem, bind-mountem worktree a injektovanými secrety. `GET /runs`/`:id` navíc nemá ownership filtr → cross-tenant čtení běhů. **Ověřeno.**
**Fix:** vyžadovat realm roli (`agent:run`) / service-role na všech `/runs` routách; allowlist registry-prefixů před spawnem; čtení scopovat na `userId`.

### C2 · Anonymní čtení invitation kódů + rolí + PII → self-elevace
`aisha/db/sql/tables/invitations.sql:30` + `policies/Public_can_read_active_invitations.sql`
```sql
GRANT SELECT ON invitations TO anon;                         -- všechny sloupce vč. code + role
CREATE POLICY ... TO public USING (is_active AND (expires_at IS NULL OR expires_at > now()));
```
`GET /rest/v1/invitations?select=code,role,email` bez přihlášení vrátí každý živý invite kód + zamýšlenou roli (`admin`/`staff`/`partner`) + PII. RLS filtruje řádky, ne sloupce. **Ověřeno.**
**Fix:** `REVOKE SELECT ON invitations FROM anon;` — redeem výhradně přes SECURITY DEFINER RPC.

### C3 · ~~NetBird Signal běží na jiném portu~~ → PRAVDĚPODOBNĚ FALSE POSITIVE (ověřeno 2026-07-08)
`docker-compose.coolify-netbird.yml:304-320`

**Původní hypotéza (subagent):** signal nemá `--port`, defaultuje na `:80`, ale vše míří na 10000 → mesh nefunguje.

**Ověření vyvrátilo premisu.** NetBird issue [#4871](https://github.com/netbirdio/netbird/issues/4871) (uživatel debugující přesně tento symptom) i [oficiální docs](https://docs.netbird.io/selfhosted/maintenance/configuration-files) potvrzují: **standalone signal proces poslouchá uvnitř kontejneru na 10000 by default**, ne na 80. Staré `10000:80` mapování v šablonách bylo samo bug. → Tenhle repo míří vším na 10000 (healthcheck, Traefik, expose) **správně**; chybějící `--port` není bug, protože 10000 JE default.
**Zbytkové riziko:** nepotvrzeno na živém stacku, že image `netbirdio/signal:0.70.0` konvenci drží. **Ověřit:** `docker inspect frontend--netbird--signal --format '{{.State.Health.Status}}'` — pokud `healthy`, C3 padá definitivně.
**Akce:** neopravovat. Lekce: root-cause hypotézu o mesh dataplane vždy ověřit živou telemetrií, ne statickou dedukcí.

---

## 2. HIGH

### Backend / SQL
- **H-B1 · Blanket `anon SELECT` na všechny současné i budoucí tabulky** — `aisha/db/sql/grants/fix_missing_table_grants.sql:15-16,46` (`ALTER DEFAULT PRIVILEGES … GRANT SELECT ON TABLES TO anon` + smyčka `GRANT SELECT ON public.%I TO anon`). **Ověřeno.** Každá citlivá tabulka (`app_secrets`, `mcp_auth_tokens`, `production_credentials`, `consents`, `wearables_data`) je chráněná **jen** tím, že RLS je správně zapnuté. Jedna nová tabulka bez `ENABLE ROW LEVEL SECURITY` = plný anon leak. Root-enabler C2. **Fix:** zrušit blanket/default anon granty; anon SELECT jen per-tabulka; CI/boot assertion, že každá `public` tabulka má RLS.
- **H-B2 · Gateway `/internal/*` (deployment-executor) na veřejném edge za sdíleným statickým klíčem** — `services/gateway/src/routes/deployment-executor.ts:284-292,140-196`. Pouští `ssh … <deploy_script>` a `docker compose up -d` a `ansible-playbook` na remote hostech. Uniklý `INTERNAL_API_KEY` = RCE. **Fix:** `/internal/*` bind jen na interní síť / IP-allowlist / mTLS.
- **H-B3 · Gateway `/intranet/token-exchange`: impersonace přes spoofovatelný header** — `intranet.ts:71-75,151-170`. Identita z client-settable `x-appsmith-user-email`, gate jen sdílený klíč, razí se PostgREST JWT pro tu identitu. **Fix:** servírovat jen z interní gateway; stripnout `X-*-User-Email` na edge.
- **H-B4 · agent-runner injektuje dlouhoživé over-scoped secrety do tenant-kontejnerů** — `backends/claude-cli.ts:131-182`. `BROKER_TOKEN`, `AISHA_MCP_TOKEN`, `AGENT_GIT_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `NB_SETUP_KEY` — vše exfiltrovatelné. **Fix:** LLM přes broker proxy, per-run ephemeral git key, zúžit+zkrátit broker token.
- **H-B5 · agent-runner `/wake` bez auth když `WAKE_TOKEN` prázdný (default, fail-open)** — `routes/wake.ts:19`. **Fix:** fail-closed.
- **H-B6 · pki-bridge SAN policy: CRLF do openssl.cnf + wildcard cert na přání volajícího** — `issue.ts:13,30-38`. `"x\n.mesh.aisha.internal"` projde; `*.mesh.aisha.internal` projde → mesh-wide impersonace. **Fix:** striktní DNS-label regex; vázat CN na identitu klienta.
- **H-B7 · `TRUNCATE`/`REFERENCES`/`TRIGGER` grantnuto `authenticated` na ~100 tabulkách** vč. `bank_transactions`, `app_secrets`. RLS to neomezuje → latentní wipe primitive. **Fix:** default grant set omezit na `SELECT, INSERT, UPDATE, DELETE`.

### NetBird (data-plane)
- **H-N1 · coturn nikdy nedostane TURN creds** — `coolify/coturn.conf:28` vs. `coturn-config-init` env má jen `TURN_*` → envsubst → `user=:`. **Fix:** přidat `NETBIRD_TURN_USERNAME/PASSWORD` do env init containeru. *(Viz runbook — doporučení relay-only tenhle bod ruší.)*
- **H-N2 · Advertované STUN/TURN míří na host bez coturn** — `netbird-management.json.template:5,14` vs. coturn jen v livekit compose (v deploy story není). **Fix:** relay-only (doporučeno) nebo nasadit coturn na Frontend.
- **H-N3 · ✅ OPRAVENO · Identita agenta se na 0.70 nedržela přes restart** — core (`coolify.yml:739`), integration (`-integration.yml:349`), cosmos (`-cosmos.yml:143`) mountovaly jen `/etc/netbird` (legacy). 0.70 píše do `/var/lib/netbird/default.json` → restart = nová WG identita → duplicitní peeři → Signal odmítá streamy. Krytu vaší vlastní dokumentací (prebuilt ř. 141-151). **Aplikováno 2026-07-08:** přidán mount `/var/lib/netbird` na stejný named volume ve všech třech (YAML validováno). Zbývá deploy + ověření.
- **H-N4 · Relay hlásí veřejnou adresu — MOŽNÁ ZÁMĚR, neopravovat naslepo** — `-netbird.yml:397` (`NB_EXPOSED_ADDRESS: rels://${NETBIRD_DOMAIN}:443/relay`). Komentář ř. 382-384 ale říká, že přímý 33080 blokuje firewall/Cloudflare a klienti mají jít přes doménu:443 — takže to může být správně. Subagent hlásil konflikt s `management.json.template:24` (interní). **Akce:** diagnostikovat živě (viz runbook), pak rozhodnout.

### Deployment / OpenClaw
- **H-D1 · OpenClaw plánovač si SSRF-blokuje vlastní llm-gateway (dead-on-arrival)** — `aisha-cold-start.sh:1900` + `config.ts:56-62` allowlist `'llm-gateway,postgrest'`, `OPENCLAW_OUTBOUND_HOSTS` nikde → `planner.ts:112-128` vrací `manual_review` na každý `/api/plan`. **Fix:** `OPENCLAW_OUTBOUND_HOSTS=llm-gateway,postgrest,${LLM_GATEWAY_DOMAIN}` nebo interní `http://llm-gateway:4000`.
- **H-D2 · Velká část OpenClaw compose env je mrtvá; `OPENCLAW_OIDC_SECRET:?` hard-failuje deploy** — `-openclaw.yml:121` pro secret, který daemon nečte; `openclaw-db-init` provisionuje nepoužitou DB. **Fix:** ořezat env na kontrakt `config.ts`, zrušit `:?`, smazat `openclaw-db-init`.
- **H-D3 · aisha-edge vyžaduje external volume, který jeho manifest server nevytváří** — `-prebuilt.yml:917-919` (`aisha_v2_pki-certs`, populuje core na backendu, edge na frontendu) → čistý Frontend host failne `compose up`. **Fix:** edge `pki-certs` stack-local + vlastní pki-init.
- **H-D4 · pki-renewer je no-op, který churnuje certy** — `-pki.yml:634-735` bez expiry checku (razí každých 6 h) a nikdy nepushuje/neredeployuje. **Fix:** openssl expiry gate + Coolify push/redeploy + freshness healthcheck.
- **H-D5 · Secrets jako build args + unpinned RCE při buildu** — `-prebuilt.yml:77` `SENTRY_AUTH_TOKEN` build arg; `Dockerfile.web:143` `curl … | bash`. **Fix:** BuildKit secret mount + pinned sentry-cli.

### Frontend / testy
- **H-F1 · Web volá mrtvý endpoint `ai-lab-recommendation` (404)** — `useLabTestRecommendations.ts:160`, v gateway `ROUTE_TABLE` neexistuje. **Ověřeno** (0 výskytů v `services/`). **Fix:** zaregistrovat nebo odstranit UI cestu.
- **H-T1 · 99-spec Playwright suite neběží v žádném CI** — deploy-to-prod gate jen na unit/gates. **Fix:** nightly/on-main lane proti `docker-compose.e2e.yml`.

---

## 3. MEDIUM (kondenzovaně)

| ID | Soubor | Problém | Fix |
|---|---|---|---|
| M-D1 | `-prebuilt.yml:102-107,249-354` | **Veřejný unauth `/__mesh_diag/status.txt`** na produkční doméně — iptables NAT, WG peer tabulka, setup-key délka | Odstranit / za oauth2-proxy |
| M-D2 | `-integration.yml:161,286,316` | Host porty na `0.0.0.0` (ragnarok 9696, maestro 8020, rabbitmq 5673) | Bind na LAN/WG IP |
| M-D3 | všechny compose | `internal`+`coolify` = 1 flat network → `aisha-db:5432` z každého kontejneru | Netseg: DB na `aisha-data-net` |
| M-D6 | `svc-pki-bridge/src/server.ts:96,219` | `/diag`+`/diag/openxpki-state` bez auth → leak `audit.log`. **Ověřeno.** | Gate za verifyToken |
| M-B1 | `partner_profiles.sql:56` | anon SELECT → email, telefon, `stripe_connect_account_id` | Revoke anon, curated view |
| M-B2 | `edge_database_dump_table.sql:87` | EXECUTE `authenticated` — RLS-bypass dump PHI/PII | service_role-only |
| M-B4 | `svc-source-broker/pg-readonly-driver.ts:142 vs 299` | Nekonzistentní join key `core_profile` (`p.id` vs `p.user_id`) | Sjednotit FK + test |
| M-F1 | `useGovernanceProposals.ts:35` + `mobile-app/src/app/governance.tsx:64` | Ruční fetch mimo API klient, `apikey` bez Bearer, `if(!res.ok) return []`. **Web i mobil.** | Přes `api.invoke()` |
| M-F2 | `useDesignProfile.ts:100` | Posílá KC access token na externí n8n webhook | Proxy přes gateway |
| M-T1 | `vitest.config.ts:37-42` | Coverage 80 % nastavené, CI bez `--coverage` → dekorace | Enforce nebo smazat |
| M-T2 | `ci.yml:346-358` | Blanket retry na jakýkoli fail → maskuje flaky | Scope na OOM signatury |
| M-T3 | `ci.yml:1643-2031` | Semgrep/trivy/npm-audit jen `workflow_dispatch` + `\|\| echo` | Weekly schedule + gating |
| M-E1 | `DashboardPanel.ts:272,409,452` | Webview CSP `frame-src https: http:` + `postMessage(…, '*')` | Pin na resolved origin |

---

## 4. LOW / hygiena (výběr)
- `.DS_Store` napříč repem; lokálně sedí `.env.coolify`, `.env-prod-backup*` — gitignorované (OK), ale citlivá data ve working tree.
- `src/tests` — `strict:true` ale `noImplicitAny:false`, `noUnusedLocals:false` → mrtvý kód se hromadí neviditelně.
- `index.html:33` og:image míří na ephemeral Lovable R2 bucket.
- `workbench/.github/workflows/build.yml` — dead CI (git server čte jen root) + hard-fail bez `RELEASE_REPO`.
- `extensions` CI lane `npm run build` (neexistuje; je `compile`) → no-op; zed/claude bez CI.
- `.env.coolify.example` legacy Supabase template — chybí ~22 OpenClaw, ~23 PKI, ~43 exec vars (mnohé `:?required`).

---

## 5. Plán postupu — A až Z

Řazeno podle **blast-radius × cena opravy**.

### FÁZE 0 — Stop-the-bleeding (~1–2 dny)
- **A.** `REVOKE SELECT ON invitations FROM anon` + redeem RPC. *(C2)*
- **B.** Odstranit `/__mesh_diag` z web nginx. *(M-D1)*
- **C.** Zrušit blanket anon default privileges + per-table smyčku. *(H-B1)*
- **D.** `/internal/*` a `/intranet/*` sundat z veřejného edge; stripnout `X-*-User-Email`. *(H-B2, H-B3)*
- **E.** agent-runner: role/service gate + image allowlist na `/runs`; `/wake` fail-closed. *(C1, H-B5)*
- **F.** pki-bridge: `/diag*` za auth; striktní SAN regex. *(M-D6, H-B6)*

### FÁZE 1 — Mesh jako interní izolační vrstva (~2–4 dny) → viz `docs/deploy/MESH_CUTOVER_RUNBOOK.md`
- **G.** ✅ Volume mount `/var/lib/netbird` (core/integration/cosmos) — **aplikováno**. *(H-N3)*
- **H.** Živá diagnostika mesh (healthcheck states, `netbird status` per peer, relay/signal logy) — určit skutečný blocker.
- **I.** Podle diagnostiky: relay identita *(H-N4)* + TURN strategie *(relay-only doporučeno, H-N1/N2)*.
- **J.** Flip `MESH_ENABLED=true` + `scripts/smoke-netbird.sh` + ověřit edge→core přes wt0.
- **K.** Navázat: netseg — DB/redis mimo flat network *(M-D3)*, integration porty na WG IP *(M-D2)*.

### FÁZE 2 — Integrita deploye (~1 týden)
- **L.** edge `pki-certs` → stack-local volume + vlastní pki-init. *(H-D3)*
- **M.** pki-renewer: expiry check + Coolify redeploy + freshness healthcheck. *(H-D4)*
- **N.** CA bundle assembler místo statické kopie v openclaw/llm-gateway/exec.
- **O.** OpenClaw: SSRF allowlist / interní URL; ořezat env; zrušit `:?` OIDC; smazat `openclaw-db-init`. *(H-D1, H-D2)*
- **P.** Secrets ven z build args + pin sentry-cli. *(H-D5)*
- **Q.** Image pinning; Caddyfile `encode` fix; regenerovat `.env.coolify.example` z env-doctor.

### FÁZE 3 — SQL hardening (~3–5 dní)
- **S.** `REVOKE TRUNCATE, REFERENCES, TRIGGER FROM authenticated`. *(H-B7)*
- **T.** CI/boot assertion: každá `public` tabulka má RLS.
- **U.** partner_profiles anon revoke; edge_database_dump_table service_role-only; audit insert `WITH CHECK`.

### FÁZE 4 — Test safety net (~1 týden, paralelně)
- **V.** Playwright do CI (nightly + on-main smoke), publikovat pass/skip counts. *(H-T1)*
- **W.** Enforce/smazat coverage; retry scope na OOM; supply-chain weekly gating.
- **X.** CI drift: `test-extension` `build`→`compile`; coldstart-db-gate hard-fail.

### FÁZE 5 — Frontend/mobil drift + hygiena (~3–5 dní)
- **Y.** `ai-lab-recommendation` fix/remove; governance/design hooky přes `api.invoke()`; sync `.env.example`; route `errorElement`.
- **Z.** workbench CI na root; extension webview CSP pin; `.DS_Store` gitignore + purge.

---

## 6. Silné stránky (ať se nezničí při opravách)
Constant-time secret compare, JWKS-ISS-pinned auth guardy (source-broker exemplární), SSRF `safeFetch`, krátkodobé mintované tokeny (nikdy `service_role`), race-safe `FOR UPDATE SKIP LOCKED`, žádná shell/dynamic-SQL injection, SAN-drift-aware idempotentní PKI issuance, ~5,4k deterministických unit testů bez `.only`, secret fingerprints (ne hodnoty) v logách. Mobil: tokeny výhradně v SecureStore.
