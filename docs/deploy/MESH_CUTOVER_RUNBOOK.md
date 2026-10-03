# Mesh cutover runbook — plné zapnutí NetBird jako interní izolační vrstvy

> Vytvořeno: 2026-07-08 · Souvisí s auditem `docs/audit/2026-07-07-repo-audit-a-z.md` (Fáze 1)
> **Princip:** mesh je zapnutý pro **vnitřní izolaci a bezpečnost stacku** — veškerý cross-server provoz (edge ↔ core/integration/cosmos) jde přes WireGuard, ne po plochém `coolify` networku. Cíl je `MESH_ENABLED=true` jako stabilní stav.

---

## 0. Kde jsme teď

`MESH_ENABLED=false` (`config/domains.env:217`) je dnes defaultní „de-facto stable state": edge-proxy dosahuje na backend přes veřejné `*.${INTERNAL_TLD}` přes TLS (backend Traefik), **ne** přes mesh. To funguje, ale:
- cross-server provoz teče po veřejné cestě (žádná mesh izolace),
- `internal` i `coolify` docker network jsou fakticky jedna plochá síť → `aisha-db:5432`, redis, ES jsou dosažitelné z každého kontejneru (audit M-D3).

Cílový stav: `MESH_ENABLED=true` → edge-proxy → mesh-router (DNAT) → `wt0` → core peer přes WireGuard.

---

## 1. Co už je aplikované (2026-07-08)

**H-N3 — persistence identity agentů (opraveno).** Core/integration/cosmos NetBird agenti mountovali jen `/etc/netbird`; NetBird 0.70+ ale píše identitu do `/var/lib/netbird/default.json`. Bez perzistence se každý restart re-enrolloval s novým WG klíčem → duplicitní peeři → Signal odmítal streamy. Přidán mount stejného named volume i na `/var/lib/netbird`:

| Soubor | Volume | Řádek |
|---|---|---|
| `docker-compose.coolify.yml` | `netbird-frontend-data-v3` | ~747 |
| `docker-compose.coolify-integration.yml` | `netbird-backend-data-v3` | ~355 |
| `docker-compose.coolify-cosmos.yml` | `netbird-experimental-data-v3` | ~149 |

Zarovnáno na váš vlastní ověřený vzor z edge mesh-routeru (`docker-compose.coolify-prebuilt.yml:141-151`). YAML validováno. **Zbývá deploy těch tří stacků + ověření (krok 4).**

**C3 — Signal port: neopravovat.** Hypotéza „signal běží na :80" byla vyvrácena ([NetBird #4871](https://github.com/netbirdio/netbird/issues/4871) + docs): standalone signal defaultuje na 10000, což je přesně to, na co repo míří. Config je správně.

---

## 2. Doporučení k TURN: **relay-only** (odpověď na otevřenou otázku)

**Doporučuji relay-only, bez coturn.** Odůvodnění podle vaší topologie:

- Mesh spojuje **pevnou sadu vašich serverů** (frontend ↔ backend ↔ experimental), ne roamující klienty za nepřátelským NAT. To je nejjednodušší případ pro konektivitu.
- Váš vlastní komentář (`docker-compose.coolify-netbird.yml:382-384`) říká, že **přímý port 33080 blokuje firewall/Cloudflare** — proto relay jede přes `rels://…:443`. Stejný firewall skoro jistě blokuje i STUN/TURN `3478/udp`, takže P2P hole-punching by stejně nefungoval.
- coturn dnes **není nasazený** na správném hostu a advertované `stun/turn:${NETBIRD_DOMAIN}:3478` míří nikam (audit H-N2) — každý peer na to marně zkouší a plní log.
- NetBird stejně **nejdřív zkouší direct WireGuard** (přes lokální/host kandidáty) a relay je fallback. Pro servery se vzájemně dosažitelnými IP se direct WG tunel vytvoří i bez STUN; kde ne, relay garantuje spojení.

**Praktický dopad:** relay-only ruší H-N1 (coturn creds) i H-N2 (advertised-but-absent). Krok 3.C níže odstraní mrtvou STUN/TURN inzerci. Pokud později naměříte, že relay latence vadí vysokopropustnému internímu provozu, coturn se dá dodat samostatně (nasadit na Frontend + `NETBIRD_TURN_USERNAME/PASSWORD` do `coturn-config-init`).

---

## 3. Cutover — krok za krokem

> ⚠️ Kroky 4–7 potřebují běžící infra a `docker`/`netbird` CLI na hostech. Ty je pouštíš ty — na tvoji infra z tohoto prostředí nedosáhnu. U každého je uvedeno, co má vyjít.

### Krok 3.A — Redeploy tří stacků s novým mountem (bezpečné, nezávislé na MESH_ENABLED)
Aplikuje H-N3 fix. Mesh je pořád OFF, takže žádné riziko.
```bash
# core (frontend), integration (backend), cosmos (experimental)
# přes vaši redeploy cestu, např.:
node scripts/aisha-redeploy.mjs --stack core --stack integration --stack cosmos
# nebo v Coolify UI redeploy těch tří apps
```
**Ověření — identita teď přežívá restart:**
```bash
docker exec frontend--core--netbird sh -c 'stat -c %s /var/lib/netbird/default.json 2>/dev/null || echo MISSING'
docker restart frontend--core--netbird && sleep 20
docker exec frontend--core--netbird sh -c 'stat -c %s /var/lib/netbird/default.json'   # stejná velikost, ne MISSING
docker logs frontend--core--netbird --tail 20 | grep -i "reconnecting\|existing config"  # ne "enrolling"
```

### Krok 3.B — Živá diagnostika current mesh (než cokoli zapneš)
Tohle určí **skutečný** blocker (statická dedukce nás u C3 zmýlila — teď jedeme podle telemetrie).
```bash
# 1) Zdraví control-plane
for c in frontend--netbird--management frontend--netbird--signal frontend--netbird--relay \
         frontend--netbird--internal-tls; do
  echo "== $c =="; docker inspect "$c" --format '{{.State.Health.Status}}' 2>/dev/null
done
# Očekávané: všechny "healthy". Když signal != healthy → C3 znovu otevřít.

# 2) Registrace peerů (na kterémkoli agentovi)
docker exec frontend--core--netbird netbird status --detail 2>&1 | head -40
# Hledej: "Management: Connected", "Signal: Connected", a peery s "Direct"/"Relayed".
# "connection reset"/"registration header" u signalu → signal port/route problém.

# 3) Relay dosažitelnost z peeru
docker exec frontend--core--netbird sh -c 'nc -z -w3 ${NETBIRD_MESH_HOST:-127.0.0.1} 33073; echo rc=$?'
```
**Zapiš si výstupy** — podle nich se rozhodne krok 3.C a 3.D.

### Krok 3.C — Relay-only: odstranit mrtvou STUN/TURN inzerci *(dle doporučení §2)*

> ⚠️ **Aplikuj až PO diagnostice 3.B** — záměrně, ať víme, že relay path je zdravá, než vypneme STUN inzerci. Pokud 3.B ukáže relay jako nezdravé, **NEODSTRAŇUJ** STUN/TURN a nejdřív oprav relay (§3.D).

V `coolify/netbird-management.json.template` **smaž řádky 2–22** — celý `"Stuns"` array (ř. 2–9) i celý `"TURNConfig"` objekt (ř. 10–22). `"Relay"` blok (ř. 23–27) a všechno ostatní ponech beze změny.

> ⛔ **SMAZAT, ne zakomentovat.** NetBird management binárka parsuje tenhle soubor jako **striktní JSON** — JSON nemá syntaxi komentářů, takže `//` nebo `#` rozbije parse při startu. Musí to být hard delete.

Výsledný začátek souboru po editaci (relay-only):
```json
{
  "Relay": {
    "Addresses": ["rels://${NETBIRD_MESH_HOST}:${NETBIRD_MESH_PORT}/relay"],
    "CredentialsTTL": "24h",
    "Secret": "${NETBIRD_RELAY_SECRET}"
  },
  "Signal": { ... },
  ...
}
```
Řádek 1 `{` následuje rovnou `"Relay": {` — validní JSON (Stuns byl první klíč, takže jeho smazáním nevznikne osiřelá čárka; Relay si drží vlastní čárku před `"Signal"`).

Tím agenti přestanou dostávat mrtvé STUN/TURN kandidáty a zmizí marné P2P pokusy do firewallem blokovaného `3478/udp`. **Redeploy netbird management stacku** (ne tří agentů) tuhle změnu aplikuje. Gate-safe: žádný gate neasertuje přítomnost `Stuns`/`TURNConfig` (ověřeno — gaty vyžadují jen `Signal`+`Relay` na dynamickém portu, což relay-only zachovává).

*(Tuto editaci držím záměrně mimo doprovodný PR — je `conditional_on_telemetry`. Po zeleném 3.B ji buď aplikuj ručně a slož do follow-up PR na stejné větvi, nebo jako samostatný commit.)*

### Krok 3.D — Relay identita (H-N4) — jen pokud to 3.B ukáže jako problém
Pokud `netbird status` v 3.B ukazuje relayed spoje, které se lámou / jdou po veřejné cestě, teprve pak zvážit sjednocení `NB_EXPOSED_ADDRESS` (`-netbird.yml:397`) s tím, co inzeruje management (`management.json.template:24`). **Neopravovat naslepo** — může to být záměr (firewall na 33080).

### Krok 4 — Flip MESH_ENABLED
```bash
node scripts/aisha-mesh-toggle.mjs --status    # ověř current
node scripts/aisha-mesh-toggle.mjs --on        # zapne mesh + redeploy edge
```

### Krok 5 — Ověření mesh dataplane
```bash
bash scripts/smoke-netbird.sh                   # existující smoke test
# a ručně:
docker exec frontend--core--netbird netbird status --detail | grep -E "Direct|Relayed|Connected"
# edge → core přes wt0:
docker exec <edge-mesh-router> sh -c 'curl -sf http://<CORE_MESH_IP>:8080/__mesh_health'   # "ok"
```
**Zelené = mesh nese interní provoz.** Pokud ne, `--off`, sesbírat logy (`docker logs frontend--core--netbird`), rollback dle §4.

### Krok 6 — Peer discovery sync
```bash
node scripts/coolify-mesh-sync.mjs --apply      # zjistí live core peer IP a PATCHne CORE_MESH_IP na edge
```

### Krok 7 — Interní izolace (navazuje, ne blokuje cutover)
Teprve s funkčním mesh (kroky 4–6 zelené) dává smysl utáhnout plochou síť (audit M-D3, M-D2). **Toto je nejrizikovější krok celého programu — dělej ho poslední a po částech.**

**7.a Netseg — DB/redis/ES na `aisha-data-net` (M-D3).** Rozšířit `docker-compose.coolify.netseg.yml` (dnes pokrývá jen svc-plugin-system). Postup je **aditivní-první, drop-plochý-poslední**:
1. Na každém hostu spustit `bash scripts/infra/create-netseg.sh` (idempotentní; vytvoří external sítě `aisha-{frontend,backend,data}-net`). Bez toho netseg deploy failne na chybějící síť.
2. **Přidat** `aisha-data-net` membership k db/pgbouncer/redis/ES **a `internal` PONECHAT** — additivní, reverzibilní, nic neodpojí.
3. Postupně **každého konzumenta** (postgrest, gateway, všechny `svc-*`, langfuse, ragnarok, maestro) přidat na `aisha-data-net`.
4. **Až jako úplně poslední** dropnout `internal` z db/redis/ES.
   > ⛔ Dropnutí `internal` z db/redis/ES **okamžitě odřízne konektivitu KAŽDÉMU konzumentovi, který ještě není na `aisha-data-net`**. Dnes jsou všichni konzumenti jen na ploché `coolify` síti. Kompletní migrace konzumentů MUSÍ předcházet dropnutí. Toto je jediné největší connectivity riziko cutoveru.

**7.b Integration porty na WG/LAN IP (M-D2).** `docker-compose.coolify-integration.yml`: ragnarok `9696` (ř. ~162), maestro `8020` (ř. ~287), rabbitmq `5673:5672` (ř. ~317) dnes bindují `0.0.0.0`. Přebindovat na `${INTEGRATION_BIND_IP:-127.0.0.1}:HOST:CONTAINER` (vzor z `docker-compose.e2e.yml:10,33,72`), `INTEGRATION_BIND_IP` nastavit na wt0/LAN IP.
   > ⚠️ **Před shipnutím ověř** (`never-assume-verify`): žádný jiný server nesmí dosahovat ragnarok/maestro/rabbit přes **veřejný** host port — intra-stack volání jdou přes container DNS (`ragnarok:9696`, `rabbitmq:5672`), ne přes host port. Pokud nějaký cross-server caller ten veřejný port používá, `127.0.0.1` default ho rozbije. Grep: `grep -rn '9696\|8020\|5673' scripts/ services/ config/`.

### Krok 8 — Post-cutover cleanup (až po zeleném kroku 5)
- **Odstranit temp mesh-diag scaffolding (M-D1).** `docker-compose.coolify-prebuilt.yml:107` mountuje `mesh-diag:/usr/share/nginx/html/__mesh_diag:ro` na **veřejný** `web` nginx → `https://${APP_DOMAIN}/__mesh_diag/status.txt` leakuje iptables NAT, WG peer tabulku, délku setup-key bez auth. Sám soubor je značený *„Remove once mesh routing is confirmed working"*. Po zeleném kroku 5 **smazat ř. 107** (mesh-router si dál píše `/diag/status.txt` na vlastní volume, ř. 160 → stále čitelné přes `docker exec <mesh-router> cat /diag/status.txt`). Diagnostika 3.B/5 stejně jede přes `docker exec`+`netbird status`+`/__mesh_health`, ne přes veřejné `/__mesh_diag`.

### Souběžné security follow-upy (mimo mesh cutover, netrackuje ho, ale patří k „interní komunikaci")
- **M-D6 — pki-bridge `/diag` leak.** `services/svc-pki-bridge/src/server.ts:96` (`/diag`) + `:219` (`/diag/openxpki-state`) běží **bez auth** → tail `audit.log` (access log k privátním klíčům). Ogatovat přes `verifyToken` (už exportováno, `auth.ts:111`; `setErrorHandler` mapuje `AuthError→401`). **Ponechat OTEVŘENÉ** `/diag/ca-bundle` (ř. 165 — cross-stack CA refresh, jinak padne `core-vanish-root-fixes.gate:90-91`) i `/health` (ř. 40). Řeší se samostatným PR (viz spawned task).

---

## 4. Rollback
Vše je bez destrukce dat (jen síťová cesta + additivní mount):
```bash
node scripts/aisha-mesh-toggle.mjs --off        # zpět na public TLS fallback
```
Mount `/var/lib/netbird` je additivní a bezpečný nechat i při mesh OFF (agent ho jen nevyužije). Kdyby přesto vadil, odeber přidané řádky ve třech compose souborech a redeploy.

---

## 5. Definition of done
- [ ] Tři stacky redeploynuté, `default.json` přežívá restart (3.A).  ← **H-N3 kód v tomto PR**
- [ ] Control-plane healthchecks zelené; `netbird status` = Management+Signal Connected (3.B). *(potvrdí i C3 = false positive přes `docker inspect …signal… Health.Status==healthy`)*
- [ ] STUN/TURN inzerce smazaná (ř. 2–22), relay path zdravá (3.C).
- [ ] `MESH_ENABLED=true`, `smoke-netbird.sh` zelený, edge→core přes wt0 / `/__mesh_health`==`ok` (4–5).
- [ ] `coolify-mesh-sync.mjs --apply` proběhl; `wg show` bez duplicitních/osiřelých peerů (6).
- [ ] (Navazující) DB/redis/ES na `aisha-data-net`, `internal` dropnut až po migraci všech konzumentů (7.a); integration porty off `0.0.0.0` (7.b).
- [ ] Temp `/__mesh_diag` scaffolding smazané (M-D1, ř. 107) po zeleném kroku 5 (8).
- [ ] *(samostatný PR)* pki-bridge `/diag*` za auth (M-D6).
