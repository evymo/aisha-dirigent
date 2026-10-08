---
name: aisha-nasazeni-nedoteklo
description: Zjisti, proč se nasazený artefakt nezměnil, i když je CI zelená — měřením CÍLE, ne kanálu. Použij, když web/extranet servíruje starou verzi, deploy úloha skončila zeleně a přesto se nic nezměnilo, nebo když je potřeba dokázat, že konkrétní commit je nasazený. Triggers on "deploy je zelený ale nic se nezměnilo", "starý bundle", "web je starý", "nenasadilo se", "last-modified", "stale deploy", "deployment failed", "wave orphan", "force_rebuild". Kritické: barva úlohy, zdraví kontejneru ani seznam aktivních nasazení NEODPOVÍDAJÍ na otázku „je nasazený můj kód".
---

# Nasazení nedoteklo — diagnostika

Runbook pro jednu otázku: **je na cíli můj kód?** Vznikl 2026-08-09/10, kdy web
tři dny servíroval starý bundle ze **čtyř nezávislých příčin nad sebou** —
a každá sama by stačila.

⚠️ Tenhle skill NENÍ o `aisha-deploy-flow` (drift, blue/green, rollback). Ten
popisuje deploy jako PRODUKT; tenhle popisuje, jak zjistit, že nasazení
neproběhlo.

## ⛔ Zlaté pravidlo

**Měřidlo, které nemůže odpovědět „ne", není měřidlo.** Tyhle na otázku
NEODPOVÍDAJÍ:

| tohle měří | ...ale ne to, co chceš vědět |
|---|---|
| barva CI úlohy | že doběhla ÚLOHA |
| `aisha-redeploy.mjs`: „healthy after" | zdraví KONTEJNERU — starý je taky zdravý |
| `GET /api/v1/deployments` | jen AKTIVNÍ nasazení; spadlé zmizí, nezařazené se neobjeví |
| `fqdn` appky v Coolify | jen sslip; domény per službu jsou v `docker_compose_domains` |
| první `<script src>` v HTML | VENDOR bundle — ten se nemá měnit |

## Postup (v tomhle pořadí)

### 1. Změř CÍL, ne kanál

```bash
curl -sSI https://<host>/ | grep -i last-modified          # stáří artefaktu
curl -sS  https://<host>/ | grep -o 'assets/[^"]*\.js'     # POROVNEJ APLIKAČNÍ, ne vendor
```

⭐ **Nejrychlejší je revize zapečená v bundlu.** Stáhni aplikační bundle a najdi
40-hex commit; porovnej s `main`. Když tam místo commitu leží `"main"` nebo
prázdno, je rozbité i samotné měřidlo (viz krok 5).

### 2. Nasazuje ten stack vůbec někdo?

Jméno appky ze jména compose souboru **NEPLYNE** — šest z 29 se liší
(`-prebuilt.yml`→`edge`, `-cosmos`→`ledger`, `-langfuse`→`observability`,
`-n8n`→`orchestration`, `-matrix`→`messaging`, `-observability`→`observability-stack`).

Autorita je `coolify/manifests/aisha.manifest`, ne odhad:

```bash
grep '^app:' coolify/manifests/aisha.manifest      # jméno:vrstva:compose
grep -n 'deploy-and-verify.sh\|coolify-resolve-uuid.sh' .github/workflows/ci.yml
```

Hlídají to brány `stack-bez-deploy-ulohy` (compose s `build:` musí být
v manifestu a mít deploy cestu) a `redeploy-wave-coverage` (appka manifestu musí
mít vlnu). App mimo WAVES je **„wave orphan"** — cold-startem skončí
`exited:unhealthy` a ani `--only` na ni nedosáhne.

### 3. Ví o té změně detektor?

```bash
node scripts/aisha-changed-apps.mjs --base=<sha>~1 --head=<sha> --json
```

CI nasazuje z pole **`nasadit`** (stavba: compose, Dockerfile i v kořeni repa,
zdroj `COPY`). Je-li appka jen v **`jen_kontrakt`** (manifest, verze obrazů,
domény, env-doktor), CI ji NENASADÍ — hodnoty jdou z trezoru, který CI nemá;
dorovná ji `bash scripts/aisha-cold-start.sh --skip-create`. Prázdné `nasadit`
= CI usoudí „redeploy netřeba". Web SPA staví **edge** (`Dockerfile.web` je
jediné místo s `vite build`), ne core — hlídá brána `detektor-zna-edge`;
kořenové Dockerfily a zdroje COPY hlídá `zmena-sluzby-dosahne-na-svuj-stack`.

### 4. Vzniklo nasazení a jak dopadlo?

```bash
GET /api/v1/deployments/applications/<app_uuid>   # HISTORIE včetně failed
GET /api/v1/deployments/<deployment_uuid>         # stav KONKRÉTNÍHO nasazení
```

⛔ Nepoužívej globální `/api/v1/deployments` — vrací jen aktivní a je **sdílený
s cizí instancí** (běžně v něm bývá 16 nasazení jiného tenanta).

Ve výpisu si všímej `status` a `force_rebuild`. Log je v poli `logs`
(JSON řetězec) — parsuj ho, negrepuj:

```bash
… | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const d=JSON.parse(s); console.log(d.status);
  JSON.parse(d.logs).forEach(x=>{const o=String(x.output||"");
    if (/error|ERROR: process|npm error/.test(o)) console.log(o.slice(0,160));});})'
```

⚠️ Odpověď je JEDEN řádek a `"status"` je v ní víckrát (i vnořený
`running:healthy` aplikace). **Hladový `sed` vrátí jiný než top-level.**

### 5. Compose je JEDEN CELEK

Spadne-li build KTERÉKOLI služby, nevymění se **žádný** kontejner — i když se
obraz té tvojí postavil úspěšně. Vada v `svc-knock` takhle držela starý `web`.

V logu hledej `ERROR: process "/bin/sh -c …"` a podívej se, **které služby**
se to týká — nemusí to být ta, kterou zkoumáš.

### 6. Oprav cestu, ne výskyt — a nech nasadit automat

⛔ Rozhodnutí majitele 2026-09-16: **nic se nenasazuje ručně.** Nedotekla-li
změna, je vadná automatická cesta (detektor, vlny, úloha) — oprav ji a nech
nasadit CI (`Deploy: Kořen` / vlastní úlohy Core·Edge·Extranet / `Deploy:
Stacky po vlnách`). Chybí-li appce proměnná nebo jde o kontrakt, dorovnej
instanci cold-startem:

```bash
node scripts/aisha-redeploy.mjs --status              # jen ČTENÍ: co běží
node scripts/aisha-redeploy.mjs --only=<app> --plan   # jen ČTENÍ: vlny nasucho
bash scripts/aisha-cold-start.sh --skip-create        # dorovnání instance (trezor, env, vlny)
```

⚠️ Souhrn `healthy after` mluví o kontejneru. **Výsledek si přečti
z historie nasazení** (krok 4) a pak znovu změř cíl (krok 1).

## Čtyři příčiny z 2026-08-09/10 (všechny opravené)

| # | příčina | oprava |
|---|---|---|
| 1 | appku `<prefix>-edge` nenasazovala ŽÁDNÁ CI úloha | #174 |
| 2 | detektor na `edge` nikdy nic neposlal (`src/`→jen `core`) | #176 |
| 3 | hlídač koukal na globální seznam AKTIVNÍCH → pád neviděl | #177 |
| 4 | `packages/knock-protocol` padal na TS2688 → compose neprošel | #178 |

⭐ Po opravě každé z nich to vypadalo hotově. **Po každé opravě znovu změř cíl.**

## Když je potřeba dokázat, že je nasazený konkrétní commit

Řetěz musí být průchozí celý:

```
workflow GIT_SHA=${{ github.sha }}
  → deploy-and-verify.sh: PATCH /applications/<uuid>/envs/bulk   ← PŘED spuštěním buildu
  → compose args: GIT_SHA
  → vite define __GIT_SHA__
  → bundle
```

⚠️ Coolify čte env při **startu** buildu; zápis po `POST /deploy` se projeví až
u NÁSLEDUJÍCÍHO nasazení. A zapisuje se **2×** (production i preview) — při
duplicitě klíče vyhrává preview.

## Související

- `.claude/skills/aisha-deploy-flow` — deploy jako produkt (drift, B/G, rollback)
- `scripts/ci/deploy-and-verify.sh` — sdílený deploy krok; `--verify-url` porovná
  otisk PŘED/PO, bez něj krok o obsahu NIC netvrdí
- brány: `stack-bez-deploy-ulohy`, `detektor-zna-edge`, `ci-deploy-honesty`,
  `redeploy-wave-coverage`, `balik-s-prepare-nesmi-brat-implicitni-typy`
