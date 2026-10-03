# Dveře: naměřený stav a návrh dalšího kroku

**Datum:** 2026-08-19 · **Stav:** podklad, fáze 2 odložena majitelem

> ⚠️ **Snímek k 2026-08-19.** Několik ⛔ v tabulce níž je dnes ✅ — zařízení má
> vlastní průkaz (VER 2, ověřeno na tabletu 2026-09-09). Aktuální popis je
> v `dvere-a-identita-2026-09-10.md`. Tenhle dokument se ZÁMĚRNĚ nepřepisuje:
> je to datované měření a bylo tehdy pravdivé.

---

## 1. Rozhodnutí majitele (2026-08-19)

Cílový model, jeho slovy:

> „zvenku není nikdy otevřeno nic, dokud nezaťuká ten, kdo je oprávněn ťukat…
> edge nepustí žádné neautorizované IP a to, že dostane automaticky autorizaci
> na IP, je jen tím, že appka sama na UDP zaklepe se svým ID… a až pak se může
> uživatel přihlásit."

- Zavírá se **packet-level na edge**, ne aplikačně. Ani `/health` zvenku neprojde.
- **Zařízení ťuká samo**, průkazem je klíč ražený při enrollu.
- Pořadí je **zaťukat → zkusit → teprve pak přihlášení**.

**⭐ Fáze teď (rozhodnuto tentýž den):** *„ten hmac, jestli je zprovoznění, tak
nám ve fázi teď stačí; druhý krok bude to zapamatovávání si a auto povolování
zařízení přes KC, který drží informace o validovaných zařízeních, resp. může to
být i administrace stacku."*

⇒ Body 3–5 níž se **teď nedělají**. Zůstává lidský kód, který funguje.

---

## 2. Naměřený výchozí stav (ne odhad)

| tvrzení | jak změřeno | výsledek |
|---|---|---|
| Dveře jsou zapnuté | `grep SPA_DOOR_MODE .env.coolify` | ⛔ chybí → default `off` |
| Dveřník hlídá víc než API | `git grep -l registerDoorGuard -- services` | ⛔ jen `services/gateway` |
| Statický seznam IP funguje | `door-guard.ts:149` | ⛔ `staticAllow: []` **natvrdo** |
| Zařízení má vlastní průkaz | `verify.ts:117` | ⛔ HMAC z **lidského hesla** |
| Roster jde měnit za běhu | `git log --all -- .../roster.ts` | ⛔ soubor **neexistuje nikde** |
| Forward má kam | `grep SPA_DOOR_FORWARD_URL` | ⛔ prázdné |

**Dnes tedy není zavřené nic** a zařízení nemá čím se prokázat. Vše ostatní
(rámec, obrana proti hádání, mapa otvorů, hook v bráně) hotové je.

⚠️ `svc-knock` svůj `SPA_STATIC_ALLOW` ctí, ale **brána ho ignoruje** — jsou to
dvoje dveře se dvěma konfiguracemi. I vyplněný seznam by nikoho nepustil.

---

## 3. Proč Secure Enclave vyžaduje novou verzi rámce

Rámec je verzovaný (`MAGIC 'SPA1'`, `VER = 1`, `TAG_BYTES = 32`). Ověřuje se
HMAC-SHA256 symetrickým klíčem z rosteru.

⛔ **Secure Enclave symetrický klíč držet neumí** — drží výhradně soukromé klíče
P-256 a podepisuje jimi. „Klíč, který nikdy neopustí telefon" proto NELZE splnit
HMACem: server by ho musel vyrobit a poslat, čímž vznikne okamžik, kdy průkaz
zařízení leží v paměti serveru a v odpovědi.

`VER 2` = tag 64 B (ECDSA P-256) místo 32 B. **`VER 1` zůstává beze změny** pro
lidský break-glass kód — dvě větve ve `verifyFrame`, ne přepsání.

⭐ Vedlejší zisk: roster pak drží **veřejné** klíče, takže `SPA_OPERATORS_B64`
s tajemstvími v prostředí každé služby přestane být potřeba.

---

## 4. Zařízení je twin, ne nová tabulka

Podle rozhodnutí z 08-09:

| co potřebujeme | čím to v tomhle světě je |
|---|---|
| `kid` zařízení | `twin_entities` |
| komu patří | `twin_relations` — vazba **s platností v čase** |
| odvolání | `valid_to` na vazbě, ne příznak |
| veřejný klíč | parametr twinu (parametry se přidávají DATY) |
| poslední zaťukání | `twin_events` |

**Enroll = existující self-service vzorec, ne nový endpoint.** `POST /auth/v1/pats`
ukazuje tvar: KC bearer → `translateAuthorizationForPostgrest` → RPC volané
JMÉNEM VOLAJÍCÍHO, takže `auth.uid()` = on a rozhoduje self-service brána
v databázi. Telefon posílá jen veřejnou část.

---

## 5. Měření: v tichém světě se nedá ZEPTAT, jen ZKUSIT

Aplikační dveřník o sobě řekne (403 + značka). Packet-level dveře mlčí
**záměrně** — a tím se zavřené dveře stanou k nerozeznání od mrtvé sítě.

⇒ Sonda nesmí být dotaz, ale **pokus**, a měří **rozdíl PŘED a PO zaťukání**:

```
dosažitelné před zaťukáním?  ANO → dveře NEJSOU zavřené  (nález, ne klid)
                             NE  → zaťukej
dosažitelné po zaťukání?     ANO → dveře fungují         ✅
                             NE  → zavřeno i pro oprávněného (nález)
```

⛔ Bez posledního řádku by sonda hlásila „ticho = v pořádku" i ve chvíli, kdy je
celá instance dole.

---

## 6. Rizika, která majitel zná a přijal

- **Není záchranná cesta.** `staticAllow` je vědomě prázdné. U packet-level
  zavření to znamená, že špatně odvozená klientská adresa nebo výpadek mapy
  zamkne i majitele a **náprava je jen fyzicky přes stroj**.
- **Pořadí zavádění:** `measure` → teprve `enforce`.
- **Ťukání zařízením je automatika.** Zákon „ťuká vždy jen člověk" platí dál pro
  **lidský kód**; automatické je výhradně zařízení se svým průkazem.
