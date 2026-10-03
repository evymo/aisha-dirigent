# Dveře: celé flow — co je změřeno, co chybí, v jakém pořadí

**Datum:** 2026-08-20 · **Navazuje na:** `dvere-stav-a-navrh-2026-08-19.md`

> ⚠️ **Snímek k 2026-08-20.** Stav popsaný níž je od té doby na několika místech
> jiný — aktuální popis je v `dvere-a-identita-2026-09-10.md`. Tenhle dokument se
> ZÁMĚRNĚ nepřepisuje: je to datované měření a bylo tehdy pravdivé.
>
> ⛔ Jedna položka byla chybná už tehdy: řádek „pověření zařízení jde vyrobit"
> s `knock-roster.mjs --device` je označený ✅, ale platí pro VER 1 (sdílené
> tajemství), ne pro VER 2. Pro VER 2 cesta neexistovala vůbec; doplnil ji
> přepínač `--pubkey` (2026-09-09).

Každé tvrzení níž má u sebe, čím je změřené. Kde měřeno nebylo, je to řečeno.

---

## 1. Zadání majitele (2026-08-20, jeho slovy)

> „První, nebo v případě nemožnosti zaťukat automaticky, ťuká uživatel. Pokud
> appka může zaťukat, tak ťuká. Pokud zaťuká automatika a nemůže se pořád
> přihlásit, asi to je třeba dořešit — zkuste zadat ruční kód, automatika
> nefunguje. **Protože můžeme to zařízení udělat neautorizovaným a nešlo by se
> dostat do režimu mít možnost zaťukat ručně.**"

> „Kód posílá stack pomocí existujících kanálů dotčeným a oprávněným uživatelům
> při jeho změně a prvním nastavení — a jen těm uživatelům, kdo se mohou
> připojovat."

> „Pošleme to push notifikací po změně už přihlášenému uživateli, který má nový
> kód dostat, a zároveň první poskytneme jinou cestou, např. přes Matrix
> a WhatsApp na číslo oprávněných uživatelů, resp. raději bych na Telegram."

---

## 2. Automatické ťukání JE už dnes HMAC — Secure Enclave není podmínka

| tvrzení | čím změřeno | výsledek |
|---|---|---|
| appka umí ťukat bez lidského kódu | `mobile-app/src/lib/knock.ts:63` | ✅ `knockOnce(cred)` bere klíčový materiál rovnou |
| kód člověka je jen obálka | `knock.ts:106` | ✅ `knockWithCode` = `deriveFromPassword` → `knockOnce` |
| pověření zařízení jde vyrobit | `scripts/knock-roster.mjs --device` | ✅ „náhodné klíče místo hesla" |
| někdo `knockOnce` volá | `grep -rn knockOnce mobile-app/src` | ⛔ **0 produkčních volajících** (jen testy) |
| je kam pověření uložit | `trezor.ts` | ⛔ knock slot neexistuje |

⇒ **Chybí tři dráty, žádná nová kryptografie.**

`VER 2` (ECDSA P-256, tag 64 B) je **zpřísnění, ne podmínka**: u `VER 1` vyrobí
klíč server a telefon si ho uloží, takže existuje na dvou místech. `VER 2` znamená
klíč, který telefon nikdy neopustí, a roster pak drží jen **veřejné** klíče.
Rozhodnutí z 08-19 platí: *„ten hmac… nám ve fázi teď stačí."*

⚠️ Zákon „ťuká vždy jen člověk" se tím neporušuje — zápis z 08-19 má výjimku:
*„automatické je výhradně zařízení se svým průkazem."*

---

## 3. Cesta ven z cihly — naměřená vada, opravená

    grep -rn "/zaklepat" mobile-app/src   →   JEDINÝ výskyt: kroky.tsx:534

Ta cesta vede z banneru po **neúspěšném odeslání**, tedy až po přihlášení.
V cílovém modelu se zavírá **před** přihlášením ⇒ odvolané pověření = telefon,
ze kterého se nedá zaťukat. Opraveno (`aaf65ec2d`): tichý odkaz v patě
přihlášení + brána, která hlídá, že aspoň jedna obrazovka pod `app/(auth)/`
na `/zaklepat` vede.

### Žebříček (`lib/dvereEskalace.ts`)

| dosažitelné | průkaz | už ťukáno | → |
|---|---|---|---|
| ano | — | — | `pokracuj` |
| ne | ne | — | `nabidni-rucni` · *bez-povereni* |
| ne | ano | ne | `zatukej-sam` |
| ne | ano | ano | `nabidni-rucni` · *automatika-neprosla* |

⛔ **Nejvýš jedno automatické zaťukání na pokus.** Naměřeno na serveru:
`SPA_MAX_INVALID=10` v okně 60 s, překročení = `SPA_COOLDOWN_SEC=300`. Smyčka by
si sama zavřela dveře, které se snaží otevřít.

⛔ **Nedá se zeptat „jsou dveře zavřené?".** Dveře mlčí i při úspěchu, takže
zavřené dveře, odvolané pověření, mrtvá síť a spadlý server vypadají zvenčí
identicky. Jediný pozorovatelný jev je ZMĚNA: nešlo to → zaťukal jsem → jde to?

---

## 4. Doručení kódu: kanál musí přežít poruchu, kvůli které existuje

Změřeno v repu:

| kanál | co existuje | projde při zavřených dveřích? |
|---|---|---|
| push | `svc-push/src/routes/send-push.ts` | ✅ stack → FCM/APNs → telefon (**odchozí**) |
| Telegram / Matrix / e-mail | `svc-openclaw` `POST /api/notify`, `channel` enum | ✅ outbox, rozesílá n8n (**odchozí**) |
| SMS | `svc-communications/src/routes/sms-otp.ts` | ✅ přes providera |
| Matrix jako ČTENÍ v appce | klient sahá na homeserver | ⛔ homeserver je **za dveřmi** |

⭐ Rozhodující rozdíl: dveře blokují **příchozí** provoz. Cokoli, co stack
odesílá ven, projde. Cokoli, co si klient musí zvenku vyzvednout, ne.

⇒ Rozdělení, jak ho majitel navrhl, sedí i technicky:
* **změna kódu → push** už přihlášenému zařízení (má token, doručuje FCM/APNs),
* **první nastavení → Telegram** přes `POST /api/notify` (`channel: 'telegram'`).

### 4.1 Push ověřen do detailu

| tvrzení | čím změřeno | výsledek |
|---|---|---|
| cílí se na UŽIVATELE, ne na token | `send-push.ts:242` `user_ids` | ✅ |
| uživatel → tokeny existuje | RPC `edge_mobile_notifications` (`send-push.ts:66`) vrací `user_id, fcm_token, device_platform` | ✅ |
| appka token registruje | RPC `update_push_token` (`types/database.ts`) | ✅ |
| interní volající smí adresovat cizí | `verifyServiceRole` jinak `selfTargetUserId` | ✅ user JWT je uzamčen sám na sebe |
| jde poslat TICHÝ push (jen data) | `send-push.ts:235`: `if (!payload.title \|\| !payload.body) → 400` | ⛔ **NE** |

⛔ **`title` a `body` jsou povinné** — typem i běhovou kontrolou. Tou routou
tedy NEJDE poslat zprávu bez viditelného textu. `data?: Record<string,string>`
existuje, ale doprovodný viditelný text zmizet nemůže.

### 4.2 Důsledek: push nese SIGNÁL, ne kód

Kód v `body` by svítil na zamčené obrazovce; kód v `data` by prošel přes
Google/Apple. U pověření, které otevírá síťové dveře, je obojí zbytečná cena —
a hlavně **nepotřebná**:

* Zařízení, které push umí zpracovat a **má platný průkaz**, si nový kód
  vyzvedne samo: zaťuká svým průkazem (ten se nemění) a stáhne ho po
  autentizovaném kanálu. Kód v pushi by mu nic nepřidal.
* Zařízení **bez platného průkazu** by z kódu v pushi profitovalo — jenže
  přesně ten případ pokrývá mimopásmové doručení (Telegram). Push tam není
  potřeba.

⇒ **Push: „Máte nový kód ke dveřím" + `data` s odkazem, kód až v appce.**
Ty dva případy se nepřekrývají, takže se návrh uzavírá bez kompromisu.

`svc-knock` už podnět „doruč nový kód" **vysílá** — `SPA_ALERT_WEBHOOK`
(`config.ts:35`, `server.ts:106`, `defense.ts:102`). Na serveru je ale
**prázdný**, takže nevede nikam. Zapojení = nasměrovat ho na `/api/notify`.

---

## 5. Co brání „jen těm, kdo se mohou připojovat"

⛔ **Roster dnes o uživatelích nic neví.** `SPA_OPERATORS_B64` je plochá mapa
`kid → pověření` v proměnné prostředí; vazba na osobu tam není žádná. Množinu
příjemců tedy nelze ODVODIT — a ručně vedený seznam příjemců break-glass kódu
je přesně ta druhá pravda, která zetlí.

Cíl podle rozhodnutí z 08-09 (viz `dvere-stav-a-navrh`, §4): zařízení je
**twin**, vlastnictví je `twin_relations` **s platností v čase**, odvolání je
`valid_to`. Teprve nad tím je „kdo se může připojovat" dotaz, ne seznam.

⇒ **Tohle je ta samá práce jako auto-autorizace zařízení.** Není to druhý úkol.

⚠️ Bezpečnostní poznámka k `/api/notify`: podle vlastního komentáře je route
„internet-exposed and authenticated only by one shared key". Únik toho klíče
neumožní kódy ČÍST, ale umožní poslat věrohodné *„váš nový kód je…"* — tedy
phishing. Než se tudy povede break-glass materiál, stojí za rozmyšlenou, jestli
zprávu neposílat bez kódu („čeká na vás nový kód, vyzvedněte v appce").

---

## 6. Pořadí, ve kterém to dává smysl

1. ~~**Roster pro appku** + `brand.knock` do profilu.~~ **PŘEKONÁNO** — viz §8.
2. **Úložiště pověření v telefonu** + zapojení `knockOnce` do žebříčku.
3. **`SPA_ALERT_WEBHOOK` → `/api/notify`**; push při změně, Telegram při prvním.
4. **Zařízení jako twin** — teprve tím vznikne odvoditelná množina příjemců
   i odvolání přes `valid_to`.
5. **`VER 2` / Secure Enclave** — zpřísnění, až bude 1–4 v provozu.

⛔ Zavádět v pořadí `measure` → `enforce` (rozhodnuto 08-19). A pozor: dnes
`staticAllow` je vědomě prázdné, takže u packet-level zavření **není záchranná
cesta** — špatně odvozená adresa zamkne i majitele a náprava je fyzicky u stroje.

---

## 7. Drobnost, která kousne

Log dveří vypsal testovací `kid` jako `sonda-dosah-[phone-redacted]` — čistič
logů vzal desetimístné číslo za telefonní. Až se budou razit `kid` zařízením,
**žádné delší číselné řady ve jménech**, jinak z logu nepoznáš, kdo ťukal.

---

## 8. Oprava: producent existuje (zjištěno 2026-08-20 po merge)

⛔ **Návrh výš, že `kid`/`scope` ponese `brand.knock` profilu appky, je
PŘEKONANÝ.** Souběžně vznikl v mainu `scripts/knock-provision.mjs` a je lepší:

    SPA_KNOCK_PUBLIC_HOST   ← PUBLIC_TLD            (UDP letí PŘÍMO na server)
    SPA_KNOCK_PUBLIC_PORT   ← .env.coolify, jinak port z compose
    SPA_KNOCK_MOBILE_KID    ← `ops-${APP_NAME_PREFIX}`
    SPA_KNOCK_MOBILE_SCOPE  ← `ops`

⭐ **Proč to smí být odvozené, když se to na klientu dosazovat nesmí:** týž
skript vyrábí ROSTER I hodnotu pro build. Shoda `kid`/`scope` tedy neplyne
z odhadu, ale **z konstrukce**. Můj návrh měl profil appky deklarovat `kid`
a roster ho měl potkat — to je právě ten zakázaný odhad, jen posunutý o krok.
`instance-env-derive.sh` proto čte všechny čtyři z instančního env, ne z profilu.

⚠️ Přibyla i **fail-closed kontrola: částečná sada = vada**. Zastavila mi
přestavbu archivu (měl jsem port, chyběly tři) — a měla pravdu: appka by
nabídku klepání skryla a důvod by se nikde neobjevil.

### Co z §1–§7 platí dál

* automatické ťukání je už dnes HMAC, chybí tři dráty (§2),
* cesta ven z cihly a žebříček (§3),
* kanál musí přežít poruchu; push nese signál, ne kód (§4),
* „jen těm, kdo se mohou připojovat" nejde odvodit — roster je pořád plochá
  mapa bez vazby na osobu (§5),
* `kid` bez delších číselných řad (§7).

### Naměřený stav dveří k dnešku

Roster na serveru **existuje** (`ops-riq`, scope `ops`) — provisioning tedy
proběhl. Tři z mobilních hodnot (`SPA_KNOCK_PUBLIC_HOST`, `..._MOBILE_KID`,
`..._MOBILE_SCOPE`) se ale do env aplikace v Coolify **nedostaly**; je tam jen
`SPA_KNOCK_PUBLIC_PORT`. ⇒ Kdo staví z Coolify env, narazí na tutéž fail-closed
kontrolu. Doplnit je patří `knock-provision.mjs`, ne ruce.
