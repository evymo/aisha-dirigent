# Identita instance vepsaná natvrdo — rozbor a měřidlo

**Datum:** 2026-08-25
**Rozsah:** netbird management, Keycloak realm, adresy a jména kontejnerů, brány

---

## Shrnutí

Fáze D cold-startu (bootstrap netbirdu) končila `401` na **každý** token, ačkoli
token byl prokazatelně platný. Příčinou nebyl token ani Keycloak, ale **identita
instance vepsaná natvrdo do sdílené šablony**.

`coolify/netbird-management.json.template` měla realm jako konstantu `aisha`
na **osmi** místech a proměnnou `${KEYCLOAK_REALM}` nepoužívala vůbec:

```jsonc
"AuthIssuer":       "https://${KEYCLOAK_DOMAIN_PUBLIC}/realms/aisha",
"AuthKeysLocation": "${KEYCLOAK_URL_FROM_CLUSTER}/realms/aisha/protocol/openid-connect/certs",
```

Management tedy očekával vydavatele `.../realms/aisha`, kdežto token nesl
`.../realms/<instance>-realm`. **Neshoda vydavatele** → `no valid authentication
provided`. `AuthKeysLocation` navíc mířilo do realmu, který v téhle instanci
neexistuje, takže si management neměl ani kde vzít klíče.

### Řetěz následků

```
realm natvrdo v šabloně
  → neshoda vydavatele → 401 na každý token
    → nevznikl účet ani setup key
      → žádný peer se nezapsal do meshe
        → mesh nevznikla
          → mesh-router neměl cíl pro DNAT
            → api 502, extranet 404
```

Hláška mluvila o tokenu. Příčina byla o pět vrstev jinde a v jiné doméně.
Tohle je opakující se vzorec — dřívější incident se stejnou strukturou je
popsaný u `pki-init` (certifikát vs. jméno mimo deklarovanou zónu).

### Proč hardcode vůbec vznikl

`netbird-init` proměnnou `KEYCLOAK_REALM` **nedoručoval**. Hardcode chybějící
proměnnou „vyřeší" tím, že ji přestane potřebovat — a s tou potřebou zmizí
i signál, že něco chybí. Proto je oprava dvojí: doplnit dosazení **a** doručit
proměnnou s `:?`, protože `envsubst` prázdnou proměnnou tiše vyrenderuje jako
`/realms//` — týž 401, jiná příčina.

---

## Měřidlo

`scripts/audit-instance-identity.mjs` (brána `instance-identity-natvrdo`).

```bash
npm run audit:identita
```

Hledá dvě podoby téže vady:

| Pravidlo | Co hlásí |
|---|---|
| `realm-natvrdo` | `/realms/<literál>` tam, kde patří `${KEYCLOAK_REALM}` |
| `prefix-natvrdo` | `container_name:` / `hostname:` / `://` s konstantou `aisha-` místo `${APP_NAME_PREFIX}` |

### Proč vlastní průchod, a ne `grep`

Obal nad `grep` v tomto prostředí ctí `.gitignore`. Audit by tedy **tiše
přeskočil** právě ty soubory, ve kterých nasazené hodnoty bydlí (`.env.coolify`
a spol.). Slepá skvrna v měřidle je horší než chybějící měřidlo — tvrdí,
že je čisto.

### Cesta od 375 nálezů k 8 skutečným

Každé zúžení je v kódu zdůvodněné, protože každým z nich by šlo měřidlo oslepit:

| Vyřazeno | Proč to není vada |
|---|---|
| vyrenderované výstupy (`.env.coolify`, `*.generated.*`, zálohy) | literál je tam **správně** — je to smysl dosazení |
| testovací fixtury | literál je **data**; test odmítnutí cizího vydavatele ten realm musí napsat doslova |
| `realms/master` | vestavěný realm Keycloaku, konstanta produktu |
| cizí poskytovatel identity (`login.eurowag.com/auth/realms/eurowag`) | konstanta z cizí smlouvy — nemáme čím dosadit, „oprava" by rozbila integraci |
| klíč služby v témže compose souboru | jméno platné jen uvnitř souboru; kolidovat může jen `container_name` na sdíleném démonu |

Pravidlo, které z toho plyne: **rozlišuj zdroj od výsledku a naše od cizího.**

### Sebetest

Detektor, který nikdy nic nenajde, je k nerozeznání od slepého. Brána proto na
dočasném stromě ověřuje, že vadu skutečně vidí — a sebetest se hned vyplatil:
napoprvé chytil **7 z 8** výskytů. Tvar `${KC}/admin/realms/aisha` propadl,
protože rozpoznávání hostitele četlo jen poslední úsek cesty a vidělo „admin"
jako cizí doménu. Slepé místo přesně na admin API Keycloaku.

---

## Past, do které nešlape skript, ale člověk

`netbird-bootstrap.sh` má u sebe zaznamenáno (2026-08-20), že **mesh management
zapisuje vlastníkem účtu prvního ověřeného volajícího**. Skript proto od té doby
neustupuje na servisní účet: servisní účet je pro IdP neviditelný, takže
management pak na vše odpovídá `403 user is pending approval` — a schválit může
jen vlastník, tedy ta neviditelná identita.

**Tahle pojistka chrání skript, ne operátora.** Při ladění stačilo jedno
diagnostické `curl` servisním klientem proti prázdnému datastoru a vlastnictví
bylo jeho; bootstrap pak přišel jako `aisha-bootstrap` a dostal `403`.

Poučení, které z toho plyne pro kohokoli, kdo bude netbird ladit:

> Volání na čerstvý mesh datastore **není jen čtení**. První ověřený dotaz
> zakládá účet a přiděluje vlastnictví. Diagnostiku dělej až po bootstrapu,
> nebo toutéž identitou, kterou bootstrap používá (`aisha-bootstrap`).

Náprava se dělá vlastníkovým oprávněním přes API netbirdu
(`PUT /api/users/<id>` → `role: admin`, `is_blocked: false`), **ne** zápisem
do databáze.

---

## Brány, které to zachytily

Během práce zafungovaly tři různá měřidla — stojí za zaznamenání, protože každé
chytilo jinou třídu chyby:

| Brána | Co odhalila |
|---|---|
| `adresa-zevnitr-clusteru-neni-verejna` | že proměnná v šabloně není doručena — a že jsem pojistku napoprvé vložil **o službu vedle** |
| `silent-degradation` | `catch { continue; }` v čerstvém auditoru: nečitelný soubor se tiše přeskočil a výsledek přesto hlásil „čisto" |
| `zadny-fallback-nad-identitou` | tři fallbacky (`${REPO_ROOT:-.}` ×2, `${MANIFEST_FILE:-…}`), které jsem sám zavedl |

Poslední dvě jsou poučné tím, že chytily **autora měřidla při psaní měřidla**.

---

## Opravená místa

- `coolify/netbird-management.json.template` — realm dosazovaný, 8 míst
- `docker-compose.coolify-netbird.yml` — `netbird-init` doručuje `KEYCLOAK_REALM` s `:?`
- `config/local-presets.mjs` — jeden domov `LOCAL_KC_REALM` místo dvou opsaných literálů
- `config/domains.env.example` — `VITE_KC_AUTHORITY` odvozeno; vzorový soubor
  vadu **rozmnožoval** do nových tenantů
- `docker-compose.local.yml` — 7× `container_name: aisha-local-*` → `${APP_NAME_PREFIX:?…}`
- brány `gateway-route-target`, `rag-embed-kickstart`, `topology-derivation`,
  `legacy-domains`, `coolify-traefik-label-substitution` — naučeny nové tvary
  zápisu, aniž by se zúžil jejich záměr

### Poznámka k opravám bran

Tři z pěti bran parsují produkční kód **textově**. To je jejich síla (fungují
offline, bez nasazení) i křehkost: změna *tvaru* zápisu je pro ně k nerozeznání
od změny *významu*. Správná oprava proto nebyla rozšiřovat pět větví rozpoznání,
ale **normalizovat tvar na vstupu** — jedno místo, všechny existující detekce
platí dál.

U `topology-derivation` bylo změněné očekávání přepsáno na **shodu pravidla
napříč profily** místo nového literálu. Literál by jen posunul pin; shoda odhalí
návrat k rozdvojení, které se právě odstranilo.
