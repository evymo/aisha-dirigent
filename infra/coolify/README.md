# Úpravy Coolify (`infra/coolify`)

Coolify je cizí produkt (`coollabsio/coolify`), který u nás běží s **našimi
úpravami**. Tenhle adresář je jejich jediný domov.

## ⛔ Proč vznikl

Naměřeno 2026-09-05 na Talosu. Šest PHP souborů bylo upravených **pouze
v zapisovatelné vrstvě běžícího kontejneru**:

```
obraz kontejneru  = sha256:f76979ac…  ==  tag coollabsio/coolify:4.3.16
náš text v OBRAZU:     0×      v KONTEJNERU: 4×
patch skript v obrazu: žádný   cron/systemd na hostiteli: žádný
```

Na těch úpravách visí **přenos obrazů na cílový uzel**, chunkování compose přes
`ARG_MAX` a ochrany disku — tedy nasazování všech instancí. Jeden
`--force-recreate` nebo self-update Coolify je smaže a nasazení se rozbije
způsobem, který vypadá jako úplně jiná porucha.

Táž třída jako `infra/sentry` a `infra/ci-runner`: *co běží mimo pipeline, musí
mít v repu aspoň domov.* Tady je ale dosah největší, protože tohle nese
nasazování celé platformy.

## Co je uvnitř

| soubor | role |
|---|---|
| `coolify.env` | **deklarace** — jméno kontejneru a verze obrazu, proti které jsou diffy |
| `diff/*.patch` | úpravy proti vrstvě obrazu, jeden soubor na jeden PHP soubor |
| `apply-coolify-patch.sh` | **narovnává** běžící kontejner podle diffů (idempotentní) |
| `capture.sh` | **zachytává** stav běžícího kontejneru do diffů (po vědomé změně) |

Ty dva skripty jdou proti sobě záměrně: `apply` je autorita repa nad strojem,
`capture` je cesta zpět po bumpu verze. Nikdy nespouštěj `capture` jako „opravu“
neshody — tím bys jen posvětil, co je na stroji.

## Použití

Obojí běží **na stroji, kde Coolify běží** (`ssh talos`), stejně jako
`infra/sentry/apply-host-config.sh`.

```bash
./apply-coolify-patch.sh --check     # nasazený stav ODPOVÍDÁ repu? (exit 1 když ne)
./apply-coolify-patch.sh --dry-run   # co by se změnilo (výchozí)
./apply-coolify-patch.sh --apply     # zapiš do kontejneru + `php -l`
```

Restart Coolify není potřeba: PHP se načítá per-request.

## ⛔ Verze je součást patche

`apply` i `capture` odmítnou běžet, když se `COOLIFY_IMAGE` neshoduje s tím, na
čem kontejner běží. Diff je proti konkrétní vrstvě; aplikovat ho naslepo na
novou verzi je horší než ho neaplikovat vůbec.

**Po bumpu Coolify:** uprav `coolify.env` → `capture.sh` → přečti `git diff` →
teprve pak commituj. Že diff proti nové vrstvě vyjde jinak, je informace.

## Co ty úpravy dělají

| soubor | úprava |
|---|---|
| `Jobs/ApplicationDeploymentJob.php` | přenos postavených obrazů na cílový uzel (build server ≠ cíl); chunkování compose a Dockerfile přes `ARG_MAX`; **očekávaná množina obrazů se bere z deklarace, ne ze snímku úložiště** |
| `Traits/ExecuteRemoteCommand.php` | doprovodné změny provádění vzdálených příkazů |
| `Actions/Server/CleanupDocker.php` | úklid, který nebere obraz běžícímu jobu |
| `Jobs/CleanupHelperContainersJob.php` | reaping zaseknutých helper kontejnerů |
| `Jobs/ServerStorageCheckJob.php` | hlídání místa na disku |
| `Livewire/Project/Application/Heading.php` | drobnost v UI |

### Závod v přenosu obrazů (opraveno 2026-09-05)

Množina k přenosu se **pozorovala** jedním dotazem na build server. Obrazy se do
úložiště objevují postupně, jak dobíhají cíle buildu — `Image X Built` v logu
neznamená, že X už je v `docker images`. Když dotaz padl doprostřed, přenesla se
podmnožina; a kontrola pod přenosem porovnávala naložené proti **té už zkrácené
množině**, takže partial prošel jako úspěch.

Naměřeno na `<fork>-exec`, týž commit, dva běhy:

```
běh 1:  3 postavené  →  Transferring 1     ⇒ na cíli chyběly DVA
běh 2:  3 postavené  →  Transferring 3     ⇒ prošlo
```

Cíl pak obraz zkusil stáhnout (`pull access denied`) a pak postavit, jenže tam
repo není — `lstat …/images: no such file or directory` — a spadl **celý stack**.

Oprava nepřidává nový zdroj pravdy, jen přestává ignorovat ten existující:
Coolify si do vyrenderovaného compose ke **každé službě s `build:`** zapisuje
`image: <uuid>_<sluzba>:<commit>`. To je deklarace. Nově se z ní bere očekávaná
množina, na build server se čeká do 300 s, a když ji nedodá, je to **hlasitá
chyba se jmény chybějících** místo tichého přenosu podmnožiny.

Ověřeno proti skutečnému nasazenému compose: 6 služeb → 3 deklarované obrazy
(právě ty stavěné; externí obrazy vynechány).
