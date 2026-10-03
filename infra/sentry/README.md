# Hostitel self-hosted Sentry

Sentry běží **mimo Coolify** (za Cloudflare, `ssh sentry`) a instalovalo se ručně,
takže jeho hostitel neměl v repu domov. Tenhle adresář je ten domov: co je tu
zapsané, jde po přestavbě stroje přehrát znovu.

- **`apply-host-config.sh`** — idempotentní, spouští se NA STROJI, dá se pustit
  opakovaně. Řeší strop žurnálu, swapfile a retenci událostí.
- Rozšíření partice **záměrně nedělá** — viz níž.

Compose stacku leží v `/root/self-hosted` (upstream `getsentry/self-hosted`).

## Rychlá diagnostika: je to disk?

Pozná se to **zvenčí**, dřív než se člověk přihlásí:

| bez tokenu | vymyšlený token | závěr |
|---|---|---|
| 401 | **500** | ⛔ padá ověřování ⇒ **padá ZÁPIS** ⇒ podezřívej disk |
| 401 | 401 | ověřování v pořádku, hledej jinde |

Nesmyslný token má dát 401. Že dá 500, znamená, že si ověření zapisuje čas
posledního použití — a ten zápis neprojde.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer nesmysl' \
  https://sentry.id3a.cz/api/0/organizations/sentry/
```

## ⛔ Po opravě disku zkontroluj, co mezitím umřelo

**Rozšíření disku samo nezvedne to, co na plném disku spadlo.** 2026-09-01 umřela
Kafka ve 21:19 (`ExitCode=1`, `RestartCount=5` — pokusy vyčerpány), disk se
zvětšil až v 00:40 a Kafka **zůstala ležet dalších osm hodin**.

```bash
docker inspect -f 'Running={{.State.Running}} ExitCode={{.State.ExitCode}} Restarts={{.RestartCount}}' \
  sentry-self-hosted-kafka-1
```

⚠️ **`docker ps` tu není měřidlo.** U mrtvé Kafky hlásil `Up 11 hours (healthy)`,
zatímco `docker exec` odpověděl `container is not running` a `State.Health`
`unhealthy`. Konzumenti proto hlásili **timeout**, ne „connection refused" —
jméno se přeloží, jen za ním nikdo není.

## Rozšíření root partice (dělá ČLOVĚK)

Disk měl 60 GB, rozdělených 40 (root 27,9 + swap 12,1). Swap ležel **za** rootem,
takže stačilo ho uvolnit a hranici posunout doprava; `resize2fs` umí ext4 zvětšit
**za provozu**.

```bash
sudo swapoff /dev/vda2
sudo sfdisk --delete /dev/vda 2
echo ", +" | sudo sfdisk --no-reread --force -N 1 /dev/vda
sudo partx -d --nr 2 /dev/vda     # ⛔ BEZ TOHO partx -u selže: jádro zná starou
sudo partx -u --nr 1 /dev/vda     #    vda2 a nová vda1 by ji přerostla
cat /sys/block/vda/vda1/size      # musí ukázat novou velikost, JINAK NEPOKRAČUJ
sudo resize2fs /dev/vda1
```

Potom `apply-host-config.sh` doplní swapfile a zbytek.

⛔ **fstab oprav DŘÍV, než cokoli rebootuješ** — swap byl zapsaný přes UUID,
které po zrušení partice neexistuje, a systemd na něj při bootu čeká.

⛔ **`sfdisk` selže TIŠE při prázdném vstupu** (překlep `cho` místo `echo`):
vypíše „The partition table has been altered" i „Done", ale `New situation`
ukáže NEZMĚNĚNOU velikost. Proto ten `cat /sys/...` mezi krokem a `resize2fs` —
jinak `resize2fs` řekne „Nothing to do" a vypadá to jako hotovo.

## Co tenhle adresář NEŘEŠÍ

Obnovu dat, verzi Sentry ani upgrade — to je věc upstreamu. Tady je jen to,
čím se tenhle konkrétní hostitel liší od čerstvé instalace.

## Deklarace hostitele: `host.env`

`apply-host-config.sh` **nemá výchozí hodnoty** — čte je z `host.env` vedle sebe
a bez nich skončí dřív, než sáhne na `fstab` nebo `journald`. Hodnoty nejsou
tajemství, jsou to vlastnosti stroje, proto jsou verzované:

| klíč | hodnota | proč |
|---|---|---|
| `SENTRY_DIR` | `/root/self-hosted` | kde leží `docker-compose` self-hosted Sentry |
| `RETENTION_DAYS` | `30` | 90 dní se na 28GB disk nevejde (~10 GB obrazy + ~9 GB data) |
| `JOURNAL_MAX` / `JOURNAL_KEEP_FREE` | `200M` / `2G` | žurnál bez stropu narostl na 2,6 GB |
| `SWAPFILE` / `SWAP_SIZE` | `/swapfile` / `4G` | swapfile místo partice — root se pak dá zvětšit kdykoli |

Změna = úprava `host.env` + nový běh skriptu (je idempotentní).
