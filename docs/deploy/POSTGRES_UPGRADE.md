# Přechod instance na jinou major verzi PostgreSQL

Major verze je parametr instance `POSTGRES_MAJOR` (build-arg `PG_MAJOR` obrazu
`infra/postgres`). Změna u **běžící** instance není restart: soubory dat jedné
major verze druhá nečte. Cesta je **dump → čistý cluster nové verze → restore →
porovnání**. Postupně, s návratem kdykoli zpět.

## Co je ověřené (2026-09-14, PG 17.11 → 18.6)

Zkouška na kopii produkční databáze instance (3,9 GB, 9 databází), obě strany
obnovené z **téhož** dumpu, porovnání otiskem katalogu a dat:

| | PG 17 (produkční obraz, kontrolní vzorek) | PG 18 |
|---|---|---|
| `pg_restore` | 0 chyb | 0 chyb |
| `heals.sql` rolí `aisha_admin` (jako `migrate`) | 0 ERROR | 0 ERROR |
| funkce (vč. md5 těla), politiky, triggery, indexy, granty, role, nastavení | — | **0 rozdílů** |
| počty řádků (705 tabulek), md5 obsahu (700 tabulek) | — | **0 rozdílů** |

Očekávané rozdíly (nejsou regresí):
- PG 18 katalogizuje `NOT NULL` jako constraint (`pg_constraint.contype = 'n'`).
- `btree_gist` 1.7 → 1.8, `pgcrypto` 1.3 → 1.4 (verze extenze patří k serveru).
- `data_checksums`: nový cluster PG 18 je má zapnuté (initdb default).

Cold-start apply i upgrade-apply brány prošly na obou verzích.

## Pasti, na které zkouška narazila

| past | projev | náprava |
|---|---|---|
| obraz `pgvector:pg18` má `PGDATA=/var/lib/postgresql/18/docker` | nad mountem `/var/lib/postgresql/data` by PG 18 **bez chyby** nastartoval prázdný cluster jinde | `ENV PGDATA` výslovně v `infra/postgres/Dockerfile` |
| obraz `pg18` deklaruje `VOLUME /var/lib/postgresql` | vedle `db-data` vznikne anonymní volume (prázdné, data v něm nejsou) | vědomě ponecháno; úklid anonymních volumes po recreate |
| výchozí `/dev/shm` 64 MB | build HNSW indexu při restore: `could not resize shared memory segment … No space left on device` | kontejner pro restore s `--shm-size 1g` |
| heals spuštěný jako `postgres` | znovu vytvořené objekty změní vlastníka → vypadá to jako drift | heals vždy rolí `aisha_admin` |

## Postup přechodu (fáze C)

Předpoklad: repo s parametrizovaným obrazem je nasazené a instance má
`POSTGRES_MAJOR` = dnešní verze (viz [UPGRADE_NASAZENE_INSTANCE.md](UPGRADE_NASAZENE_INSTANCE.md)).

1. **Zkouška nanečisto** na kopii (produkce běží dál): dump → restore do
   izolovaného kontejneru staré i nové verze (`--network none`) → otisk a
   porovnání → `heals.sql` rolí `aisha_admin` na obou → porovnání. Pokračuje se
   jen s **nulou** neočekávaných rozdílů.
2. **Okno**: zastavit zapisovatele (aplikace nad `postgres`), ověřená záloha
   pgBackRest, `pg_dumpall --globals-only` + `pg_dump -Fc` každé databáze.
3. Starý volume **nemazat** — přejmenovat/zkopírovat stranou (návrat = vrátit
   volume a `POSTGRES_MAJOR`).
4. `POSTGRES_MAJOR=<nová>` v konfiguraci instance → `KEYS=POSTGRES_MAJOR bash
   scripts/coolify-sync-envs.sh` → nasazení core nad **prázdným** `db-data`.
5. Restore globals + databází, `migrate` (heals), porovnání otisku proti dumpu.
6. Ověření po startu: `SHOW data_directory`, `SHOW server_version`, počet řádků
   známé tabulky, z brokeru `dns.lookup("<prefix>-db")` a v jeho logu žádné
   `ENOTFOUND` (money lane tiká každou minutu — výpadek jména je hlasitý).
7. `ALTER EXTENSION btree_gist UPDATE; ALTER EXTENSION pgcrypto UPDATE;` (restore
   do nového clusteru je vytvoří rovnou v nové verzi — ověřit `pg_extension`).
8. pgBackRest: nový cluster = nová stanza (`stanza-upgrade`), první plná záloha.

Starý volume se maže až po dnech provozu a po úspěšném obnovení z nové zálohy.
