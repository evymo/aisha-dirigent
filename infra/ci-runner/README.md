# CI runner (`aisha-ci-runner`) — odkaz na domov definice

CI tohoto repa běží na **hostovaných runnerech GitHub Actions** (`.github/workflows/`) — vlastní
runner není potřeba. Instance, která přesto provozuje vlastní (self-hosted) runner, ho nasazuje
jako **službu v Coolify** — mimo tenhle repozitář. Jeho definice **nebydlí tady**:

> **Zdroj pravdy:** katalog Coolify aplikací instance (např. `example-org/coolify`),
> `apps/aisha-ci-runner/docker-compose.yml` + `apps/aisha-ci-runner/README.md`
> (nasazení, proměnné, labely, úklid, ověření po deployi).
> Main katalogu je verze, která na hostiteli běží.

## ⛔ Proč tu není kopie

Do 2026-09-29 tu ležela kopie compose runneru s návodem, jak ji poslat do Coolify
(`PATCH docker_compose_raw`). Naměřeno ten den proti živé službě (Coolify API) a katalogu:

- **Rozešla se s živou verzí.** Janitor v ní neznal hlídání disku hostitele
  (`CI_HOST_MIN_FREE_GB` / `CI_HOST_ESCALATE_FREE_GB` / `CI_HOST_CACHE_RESERVED_GB`,
  mount `host-docker.sock`) a měl jiný interval (1800 s místo 600) i práh (25 % místo 35 %).
- **Nešla by nasadit.** Vstupní skripty byly víceřádkový řetězec v dvojitých uvozovkách. YAML
  v něm skládá sousední řádky do jednoho, takže každý `# komentář` spolkne příkazy až do
  prázdného řádku. Po parsování (tak jak ho vidí Compose) byla registrace runneru celá
  v komentáři a démon runneru jen další argument `echo` — runner by se nespustil. Katalog
  používá blokový skalár `- |`, který konce řádků drží.

Dvě kopie téže definice se rozejdou vždycky; ta, ze které se nenasazuje, navíc zestárne
potichu. Proto tu zůstává jen odkaz — a brána `infra-mimo-pipeline-ma-domov` hlídá, že se
kopie nevrátí.

Vlastnost, kvůli které domov vznikl (janitor nemaže cache balíčků pod běžícími joby,
2026-09-02), hlídá v katalogu test `tests/janitor-pod-tlakem.sh`. Ten janitor z compose
VYTÁHNE a SPUSTÍ proti falešnému `docker`, tedy měří chování, ne text.

## Co potřebuješ vědět i bez katalogu

⛔ **Joby self-hosted runneru s DinD běží uvnitř DinD, ne na hostiteli.** `docker ps` na
hostiteli je NEUKÁŽE a odpoví „nic neběží". 2026-09-01 se podle toho smazala npm cache pod
třemi běžícími joby. Běžící joby ukáže až dotaz uvnitř DinD:

```bash
docker exec <dind-kontejner-runneru> docker ps --format '{{.Names}}'
```

⚠️ **Přenasazení služby zabije běžící joby.** Dělej ho, když je fronta jobů prázdná.

⚠️ **Timeout jobu v konfiguraci runneru je tvrdý strop.** Runner utne job po té době bez
ohledu na `timeout-minutes` ve workflow.

## Změna runneru

PR do katalogu: validace
`docker compose -f apps/aisha-ci-runner/docker-compose.yml config --no-interpolate`
a `bash tests/janitor-pod-tlakem.sh`, nasazení podle README katalogu.
Do tohoto repa definici nekopírovat.
