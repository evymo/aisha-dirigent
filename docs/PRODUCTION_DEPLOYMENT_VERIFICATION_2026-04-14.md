# Production Deployment Verification (2026-04-14)

## Scope
Tento dokument shrnuje:
- co bylo dnes reálně ověřeno,
- co zatím ověřeno není,
- jak opakovat deployment + runtime verifikaci pro produkci.

## Snapshot (Evidence)

### 1) Git source-of-truth
Kontrola po `git fetch --all --prune`:
- `HEAD`: `b7a1f159`
- `origin/main`: `9b260a76`
- `origin/main`: `b7a1f159`
- `gitlab/main`: `26ad4c61`

Interpretace:
- git server je synchronizovaný s lokálním `main`.
- GitHub (`origin`) je v tomto snapshotu o 1 commit pozadu.
- GitLab je v tomto snapshotu o více commitů pozadu.

### 2) Produkční HTTP dostupnost
Ověřeno přes `curl -s -o /dev/null -w '%{http_code}' --max-time 20 <url>`:
- `https://web.aisha.guru` -> `200`
- `https://api.aisha.guru/auth/v1/health` -> `401`
- `https://api.aisha.guru/rest/v1/` -> `401`
- `https://langfuse.aisha.guru` -> `200`
- `https://nocodb.aisha.guru` -> `302`
- `https://appsmith.aisha.guru` -> `302`

Interpretace:
- Web je veřejně dostupný (`200`).
- API endpointy bez tokenu vrací `401` (očekávané chování).
- NocoDB/Appsmith vrací redirect na SSO (`302`) (očekávané chování).
- Langfuse endpoint je dostupný (`200`).

### 3) CI-like checks při push
Pre-push hooky byly spuštěny (gate testy, static validation, i18n check, unit tests, build).

## Co je tímto POTVRZENO
- Produkční frontend URL odpovídá.
- Produkční ingress/API vrací očekávané auth chování.
- Runtime endpointy hlavních služeb jsou síťově dostupné.
- Release commit je na `origin/main`.

## Co tímto NENÍ 100% potvrzeno
- Že všechny kontejnery v produkci běží na posledním image/tagu.
- Že je nasazen přesně commit `b7a1f159` ve všech službách.
- Že background workery a cron flows běží bez chyb.
- Že všechny certifikáty byly už převedeny na nový OpenXPKI rollout bez driftu mezi službami.

Tyto body vyžadují kontrolu v deployment platformě (Coolify/n8n/Kong/Supabase logs) a případně DB/runtime smoke testy s autorizovaným účtem.

## Integrace, bezpečná změna certifikátů a OpenXPKI

### Co jsme v této iteraci prokazatelně udělali
- Zapsali jsme release/runbook dokumentaci včetně produkčního verifikačního postupu.
- Ověřili jsme veřejnou dostupnost klíčových endpointů (web, API ingress, Langfuse, NocoDB, Appsmith).
- Sjednotili jsme postup pro opakovatelnou post-release kontrolu.

### Co jsme v této iteraci neprovedli
- Neproběhla produkční rotace certifikátu ani přepnutí trust chain přímo v tomto běhu.
- Neproběhl přímý OpenXPKI enrollment/revoke/generate_crl zásah na produkci.

To je záměrně oddělené: release verifikace != certifikační změnové okno.

### Zdroj pravdy pro PKI/OpenXPKI operace
- Incident a nouzové scénáře: [docs/pki/INCIDENT-PLAYBOOK.md](docs/pki/INCIDENT-PLAYBOOK.md)

### Safe Change Procedure (certifikáty)
1. Pre-check: potvrdit plán změny, impacted služby, maintenance okno.
2. Vydání/rotace certifikátu v OpenXPKI (RA/CA workflow).
3. Nasazení certifikátu do cílových služeb po jedné vlně (canary -> batch).
4. Ověření TLS handshake + cert chain + notAfter na každé službě.
5. Ověření funkce aplikace (SSO login, API auth, klíčové RPC).
6. Uzavření změny až po potvrzení metrik a logů bez regresí.

### Minimální ověření po cert change
```bash
# 1) TLS cert metadata
echo | openssl s_client -connect web.aisha.guru:443 2>/dev/null | openssl x509 -noout -subject -issuer -dates

# 2) API ingress chování
curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 https://api.aisha.guru/auth/v1/health

# 3) SSO aplikace
curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 https://nocodb.aisha.guru
curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 https://appsmith.aisha.guru
```

Pass kritérium:
- cert chain validní, datum expirace odpovídá nově vydanému certifikátu,
- API vrací očekávané kódy (bez neočekávaných 5xx),
- SSO endpointy odpovídají (302/login flow funguje).

### Rollback kritéria
- Pokud dojde k TLS nebo auth regresi: okamžitě rollback na předchozí cert bundle.
- Rollback musí být připraven před změnou (artifact + postup + odpovědná osoba).
- Po rollbacku provést stejnou verifikaci jako po deployi.

## Runbook: Jak ověřit release end-to-end

### A) Ověření zdrojového commitu
```bash
git fetch --all --prune
git rev-parse --short HEAD
git rev-parse --short origin/main
git rev-parse --short origin/main
git rev-parse --short gitlab/main
```
Pass kritérium:
- všechny cílové remote větve mají stejný SHA jako `HEAD`.

### B) Ověření dostupnosti produkce
```bash
curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 https://web.aisha.guru
curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 https://api.aisha.guru/auth/v1/health
curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 https://api.aisha.guru/rest/v1/
curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 https://langfuse.aisha.guru
curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 https://nocodb.aisha.guru
curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 https://appsmith.aisha.guru
```
Pass kritérium:
- web `200`,
- API bez tokenu `401`,
- SSO aplikace `302` nebo login `200`.

### C) Ověření aplikace po releasu
```bash
npm run test:gates
npm run i18n:check
npm run test:run -- src/tests/hooks/builderI18nIntegrity.test.ts
npm run build
```
Pass kritérium:
- všechny příkazy skončí `0`.

### D) Produkční provozní smoke test (manuální)
1. Otevřít `https://web.aisha.guru`.
2. Přihlášení přes SSO.
3. Otevřít admin page builder a načíst stránku.
4. Provest save/publish flow.
5. Ověřit, že se data propíšou (UI + RPC + audit trail).

Pass kritérium:
- žádná 5xx chyba,
- save/publish bez regresí,
- audit zápisy existují.

## Doporučení pro trvalou jistotu
- Zaveďte endpoint typu `/release-info` s SHA commitu a build timestampem.
- Přidejte automatický post-deploy smoke test pipeline (HTTP + auth + klíčové RPC).
- Udržujte jeden „Deployment Status“ dokument s posledním ověřeným SHA, datem a výsledky.
- Přidejte automatickou PKI kontrolu (expirace + chain + CRL/OCSP) jako release gate.
