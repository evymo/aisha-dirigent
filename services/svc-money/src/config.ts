/**
 * Konfigurace svc-money — VŠECHNO z prostředí, NIC v obrazu.
 *
 * ⭐ DVĚ NEZÁVISLÉ VĚCI, DVA BLOKY
 * „Umět se připojit do VPN" a „kam a pod čím voláme" jsou různé otázky a mají
 * různou životnost: tunel se vytáčí stejně bez ohledu na to, jestli za ním sedí
 * účetnictví, sklad nebo cokoli dalšího, kdežto cíl a pověření se mění s
 * dodavatelem. Kdyby to byl jeden blok, znamenala by výměna cíle sahání do
 * tunelu a naopak.
 *
 *   VPN_*     — obecná schopnost vytočit tunel (profil, účet, heslo ke klíči).
 *               Přenositelné: jiná služba použije týž kontrakt beze změny.
 *   MONEY_*   — kam voláme a pod jakým pověřením (host, agendy).
 *
 * ⭐ CERTIFIKÁT JE PROMĚNNÁ
 * Profil včetně klientského certifikátu přichází v `VPN_PROFILE_B64`. Rotace je
 * změna hodnoty a restart — ne přestavba obrazu, která se odkládá tak dlouho,
 * až tajemství zestárne.
 *
 * ⛔ ŽÁDNÉ VÝCHOZÍ HODNOTY U TAJEMSTVÍ. Prázdná hodnota se nesmí tvářit jako
 * nastavení; služba místo toho odmítne startovat a řekne, co chybí.
 */

/** Jedna účetní agenda = jeden port na Money + jedno API pověření. */
export interface MoneyAgenda {
  /** stabilní klíč do env i do logu (např. `MN`, `AVANT`) */
  key: string;
  /** lidské jméno — jde do `owner_company`, takže musí odpovídat účetnictví */
  label: string;
  port: number;
  clientId: string;
  clientSecret: string;
}

/** Obecná schopnost vytočit tunel — nezávislá na tom, co je za ním. */
export interface VpnConfig {
  enabled: boolean;
  profileB64: string;
  authUser: string;
  authPass: string;
  keyPassphrase: string;
  /** Kolikrát smí klient zkusit spojení, než to vzdá (proti fail2ban). */
  connectRetryMax: number;
  /** Po jaké nečinnosti cestu zavřít (ms). 0 = držet trvale. */
  idleMs: number;
  /** Nejdelší život výpůjčky cizího spotřebitele (ms); nevrácená se vrátí sama. */
  leaseTtlMs: number;
}

export interface MoneyConfig {
  port: number;
  logLevel: string;
  host: string;
  vpn: VpnConfig;
  agendas: MoneyAgenda[];
  /** Kolik dokladů na stránku; Money zvládá 500 (~5,7 s), víc se neosvědčilo. */
  pageSize: number;
  requestTimeoutMs: number;
}

/**
 * Číselná proměnná, kde PRÁZDNO znamená „nenastaveno", ne „nula".
 *
 * `??` rozlišuje jen `null`/`undefined`; prázdný řetězec projde jako hodnota a
 * `parseInt` z něj udělá NaN, které se pak tváří jako platné číslo všude, kde se
 * neporovnává. Fail-loud: nečíselná NEPRÁZDNÁ hodnota je vada konfigurace.
 */
function cislo(raw: string | undefined, vychozi: number, klic: string): number {
  const t = (raw ?? '').trim();
  if (t === '') return vychozi;
  const n = Number.parseInt(t, 10);
  if (!Number.isFinite(n)) throw new Error(`svc-money: ${klic}='${t}' není číslo`);
  return n;
}

function kladne(n: number, klic: string): number {
  if (n <= 0) throw new Error(`svc-money: ${klic}=${n} musí být kladné — výpůjčka bez stropu života je únik`);
  return n;
}

function req(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key]?.trim();
  if (!v) throw new Error(`svc-money: chybí povinná proměnná ${key}`);
  return v;
}

/**
 * Přečte obecný VPN blok. Sdílený kontrakt — jiná služba ho může použít beze
 * změny, protože o cíli za tunelem nic nepředpokládá.
 */
export function loadVpnConfig(env: NodeJS.ProcessEnv = process.env): VpnConfig {
  // Tunel se vypíná JEN výslovně — chybějící proměnná není „vypnuto".
  // (Vypnutý stav slouží zkoušce proti už běžícímu tunelu nebo proti záznamu.)
  const enabled = (env.VPN_ENABLED ?? 'true').trim() !== 'false';
  return {
    enabled,
    // ⭐ Celý .ovpn profil VČETNĚ klientského certifikátu, v base64.
    profileB64: enabled ? req(env, 'VPN_PROFILE_B64') : '',
    authUser: enabled ? req(env, 'VPN_AUTH_USER') : '',
    authPass: enabled ? req(env, 'VPN_AUTH_PASS') : '',
    // Klíč v profilu bývá zašifrovaný; když není, passphrase se nepoužije.
    keyPassphrase: env.VPN_KEY_PASSPHRASE ?? '',
    // ⛔ Strop pokusů: openvpn jinak zkouší donekonečna a protistrana to vidí
    // jako útok — fail2ban pak zavře dveře i pro správné údaje.
    connectRetryMax: cislo(env.VPN_CONNECT_RETRY_MAX, 3, 'VPN_CONNECT_RETRY_MAX'),
    // Po jaké nečinnosti cestu zavřít. Spojení do cizí sítě se nedrží otevřené,
    // když ho nikdo nepotřebuje — ale ani se necyklí: `--connect-retry-max` výš
    // existuje proto, že opakované pokusy vypadají protistraně jako útok.
    // Minuty, ne sekundy; série dotazů tak jede po JEDNOM spojení.
    // ⛔ NAMĚŘENO 2026-08-29: `??` NECHYTÍ PRÁZDNÝ ŘETĚZEC. Doručená, ale prázdná
    // `VPN_IDLE_MS=` dala `parseInt('') = NaN`; `NaN <= 0` je false, takže se
    // přeskočila i ochrana „nula = drž trvale", a `setTimeout(…, NaN)` node bere
    // jako 0 → tunel se ZAVŘEL IHNED po každém dotazu. Další dotaz pak trefil
    // openvpn uprostřed vypínání: „openvpn skončil, aniž by cesta naběhla",
    // u jiných agend `fetch failed`. Vypadalo to jako zavřené porty na straně
    // Money — a bylo to prázdno v naší proměnné.
    // ⭐ Nepoužitelná hodnota se proto NEDOSAZUJE potichu: buď je to číslo, nebo
    // padáme na startu s tím, co je špatně.
    idleMs: cislo(env.VPN_IDLE_MS, 300_000, 'VPN_IDLE_MS'),
    // ⛔ NAMĚŘENO 2026-09-15 v produkci: `/ready` hlásil `tunnel: up, leases: 11` po dvou
    // týdnech běhu, ačkoli VPN_IDLE_MS bylo nastavené. Spotřebitel (broker), který si
    // cestu vypůjčí a pak skončí dřív, než ji vrátí (nasazení uprostřed tahu, výpadek
    // sítě při DELETE), ji nevrátí NIKDY — a tunel do cizí sítě se pak už nezavře.
    // Výpůjčka proto má strop života. Vlastní dotazy (`/query`, `/probe`) si cestu drží
    // samy, takže vypršení cizí výpůjčky běžící dotaz nepřeruší.
    // Nula by znamenala „bez stropu", tedy přesně ten únik — proto ji nepřijímáme.
    leaseTtlMs: kladne(cislo(env.VPN_LEASE_TTL_MS, 900_000, 'VPN_LEASE_TTL_MS'), 'VPN_LEASE_TTL_MS'),
  };
}

/**
 * Agendy se čtou z JEDNÉ proměnné `MONEY_AGENDAS` (JSON pole).
 *
 * Alternativa — číslované proměnné `MONEY_AGENDA_1_PORT`… — vypadá čitelněji,
 * ale rozpadá se při přidání agendy: sync posílá aplikaci jen klíče, které jsou
 * v jejím compose, takže nová agenda znamená úpravu compose i env. Jedna
 * proměnná s polem je JEDNO místo, kam se sáhne.
 *
 * Tvar: [{"key":"MN","label":"Moravská nemovitostní a.s.","port":87,
 *         "clientId":"…","clientSecret":"…"}]
 */
export function parseAgendas(raw: string): MoneyAgenda[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('svc-money: MONEY_AGENDAS není platný JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('svc-money: MONEY_AGENDAS musí být neprázdné pole agend');
  }
  const out: MoneyAgenda[] = [];
  const videnePorty = new Set<number>();
  const videneKlice = new Set<string>();
  for (const [i, a] of parsed.entries()) {
    const o = a as Record<string, unknown>;
    const kde = `MONEY_AGENDAS[${i}]`;
    const key = String(o.key ?? '').trim();
    const label = String(o.label ?? '').trim();
    const port = Number(o.port);
    const clientId = String(o.clientId ?? '').trim();
    const clientSecret = String(o.clientSecret ?? '').trim();
    if (!key) throw new Error(`svc-money: ${kde}.key chybí`);
    if (!label) throw new Error(`svc-money: ${kde}.label chybí — jde do owner_company`);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`svc-money: ${kde}.port není platný port: ${String(o.port)}`);
    }
    if (!clientId || !clientSecret) {
      throw new Error(`svc-money: ${kde} nemá clientId/clientSecret`);
    }
    // Dvě agendy na jednom portu = tichá záměna dat mezi firmami. Port je
    // v Money JEDINÝ rozlišovač agendy, takže kolize je vada konfigurace.
    if (videnePorty.has(port)) throw new Error(`svc-money: port ${port} je ve dvou agendách`);
    if (videneKlice.has(key)) throw new Error(`svc-money: klíč '${key}' je dvakrát`);
    videnePorty.add(port);
    videneKlice.add(key);
    out.push({ key, label, port, clientId, clientSecret });
  }
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MoneyConfig {
  return {
    port: cislo(env.SVC_MONEY_PORT, 3016, 'SVC_MONEY_PORT'),
    logLevel: env.LOG_LEVEL ?? 'info',
    // Money sedí uvnitř VPN; adresa je operátorské nastavení, ne konstanta v kódu.
    host: req(env, 'MONEY_HOST'),
    vpn: loadVpnConfig(env),
    agendas: parseAgendas(req(env, 'MONEY_AGENDAS')),
    pageSize: cislo(env.MONEY_PAGE_SIZE, 500, 'MONEY_PAGE_SIZE'),
    requestTimeoutMs: cislo(env.MONEY_REQUEST_TIMEOUT_MS, 60_000, 'MONEY_REQUEST_TIMEOUT_MS'),
  };
}

/** Co konkrétně chybí — pro /health a pro start, bez vypsání hodnot. */
export function configDefects(env: NodeJS.ProcessEnv = process.env): string[] {
  try {
    loadConfig(env);
    return [];
  } catch (e) {
    return [e instanceof Error ? e.message : String(e)];
  }
}
