# CI runner (`aisha-ci-runner`) — odkaz na domov definice

Runner Forgejo Actions běží na **Sorenu** jako **služba v Coolify**
(uuid `ozwf7a47ik8qtzwpmstdcfph`) — mimo tenhle repozitář. Jeho definice
**nebydlí tady**:

> **Zdroj pravdy:** katalog `Evymo/coolify` (repo.id3a.cz),
> `apps/aisha-ci-runner/docker-compose.yml` + `apps/aisha-ci-runner/README.md`
> (nasazení, proměnné, labely, úklid, ověření po deployi).
> Main katalogu je verze, která na Sorenu běží.

## ⛔ Proč tu už není kopie

Do 2026-09-29 tu ležela kopie `aisha-ci-runner.compose.yml` s návodem, jak ji
poslat do Coolify (`PATCH docker_compose_raw`). Naměřeno ten den proti živé
službě (Coolify API) a katalogu:

- **Rozešla se s živou verzí.** Janitor v ní neznal hlídání disku hostitele
  (`CI_HOST_MIN_FREE_GB` / `CI_HOST_ESCALATE_FREE_GB` /
  `CI_HOST_CACHE_RESERVED_GB`, mount `host-docker.sock`) a měl jiný interval
  (1800 s místo 600) i práh (25 % místo 35 %). Katalog živou verzi nese —
  služby `docker`, `runner` i `prune` shodné.
- **Nešla by nasadit.** Vstupní skripty byly víceřádkový řetězec v dvojitých
  uvozovkách. YAML v něm skládá sousední řádky do jednoho, takže každý
  `# komentář` spolkne příkazy až do prázdného řádku. Po parsování (PyYAML,
  tak jak ho vidí Compose) zbylo ze skriptu runneru 9 řádků: registrace je
  celá v komentáři, `set -e cd /data` nikam nepřejde a `exec forgejo-runner
  daemon` je jen další argument `echo` — runner by se nespustil. Hlavní
  smyčka janitoru (`sleep` + `while … sweep`) skončila v komentáři taky.
  Katalog používá blokový skalár `- |`, který konce řádků drží.

Dvě kopie téže definice se rozejdou vždycky; ta, ze které se nenasazuje,
navíc zestárne potichu. Proto tu zůstává jen odkaz — a brána
`infra-mimo-pipeline-ma-domov` hlídá, že se kopie nevrátí.

Vlastnost, kvůli které domov vznikl (janitor nemaže cache balíčků pod
běžícími joby, 2026-09-02), hlídá v katalogu test `tests/janitor-pod-tlakem.sh`.
Ten janitor z compose VYTÁHNE a SPUSTÍ proti falešnému `docker`, tedy měří
chování, ne text.

## Co potřebuješ vědět i bez katalogu

⛔ **Joby běží uvnitř DinD, ne na hostiteli.** `docker ps` na Sorenu je
NEUKÁŽE a odpoví „nic neběží". 2026-09-01 se podle toho smazala npm cache pod
třemi běžícími joby. Běžící joby:

```bash
ssh soren 'docker exec docker-ozwf7a47ik8qtzwpmstdcfph docker ps --format "{{.Names}}" | grep -c FORGEJO-ACTIONS-TASK'
```

⚠️ **Přenasazení služby zabije běžící joby.** Dělej ho, když je fronta prázdná
(`GET /api/v1/admin/actions/runners/jobs` jako admin Forgejo).

⚠️ **`FORGEJO_RUNNER_JOB_TIMEOUT` je tvrdý strop.** Runner utne job po té době
bez ohledu na `timeout-minutes` ve workflow.

## Změna runneru

PR do katalogu `Evymo/coolify`: validace
`docker compose -f apps/aisha-ci-runner/docker-compose.yml config --no-interpolate`
a `bash tests/janitor-pod-tlakem.sh`, nasazení podle README katalogu.
Do tohoto repa definici nekopírovat.
