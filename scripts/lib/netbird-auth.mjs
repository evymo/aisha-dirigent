/**
 * netbird-auth — JEDNO místo, kde vzniká token do mesh management API.
 *
 * ⛔ PROČ EXISTUJE (naměřeno 2026-08-21 na riqi). Tři nástroje sahaly na totéž
 * API a KAŽDÝ se hlásil po svém. `netbird-dns-provision` uměl JEN
 * `client_credentials` servisního účtu — tedy identitu, kterou Keycloak do
 * výpisu uživatelů nedává a mesh management ji proto hlásí jako
 * `user is pending approval`. Ta cesta nemohla uspět NIKDY.
 *
 * Následek nebyl vidět na DNS, ale o dvě vrstvy jinde: bez záznamů propadla
 * vnitřní jména na wildcard vyhledávací domény, tedy na cizí stroj, a čtyři
 * veřejné trasy vracely 502 s certifikátem cizí instance.
 *
 * ZÁKON: do mesh API se chodí za SKUTEČNÉHO UŽIVATELE, kterého IdP vidí.
 * Servisní účet tu není náhradní cesta — je to identita, která navíc na
 * prázdném datastoru NEVRATNĚ zabere vlastnictví účtu.
 */

/**
 * Vydá bearer token bootstrap uživatele (ROPC).
 * Vrací token, nebo VYHODÍ chybu — nikdy netiché prázdno: prázdný token by
 * volající poslal jako `Bearer `, což server odmítne jako neplatné pověření
 * a diagnóza pak míří na secret místo na chybějící pověření.
 */
export async function meshUserToken({
  keycloakUrl,
  realm,
  clientId = "aisha-bootstrap",
  clientSecret,
  username = "aisha-bootstrap",
  password,
  fetchImpl = fetch,
  timeoutMs = 20_000,
} = {}) {
  if (!clientSecret || !password) {
    throw new Error(
      "Pověření bootstrap uživatele chybí (AISHA_BOOTSTRAP_CLIENT_SECRET + AISHA_BOOTSTRAP_PASSWORD).\n" +
        "  NEUSTUPUJI na servisní účet: je pro IdP neviditelný, dostal by 403 'user is pending approval',\n" +
        "  a na prázdném datastoru by se stal VLASTNÍKEM účtu — to je nevratné.\n" +
        "  CO S TÍM: spusť scripts/aisha-bootstrap-user-init.sh, pak tenhle nástroj znovu.",
    );
  }
  if (!keycloakUrl) {
    throw new Error(
      "Adresa Keycloaku není deklarovaná — čekám KEYCLOAK_PUBLIC_URL nebo KEYCLOAK_DOMAIN_PUBLIC.\n" +
        "  ⛔ NEDOSAZUJ vnitřní jméno: v tomhle prostředí se vnitřní jména překládají přes wildcard\n" +
        "  vyhledávací domény na CIZÍ stroj, takže by se pověření odeslalo někomu jinému.",
    );
  }

  const url = `${String(keycloakUrl).replace(/\/+$/, "")}/realms/${realm}/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: clientId,
    client_secret: clientSecret,
    username,
    password,
    scope: "openid",
  });

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: ac.signal,
    });
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ROPC pro ${username} selhalo: HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error(`ROPC pro ${username} vrátilo odpověď bez access_token.`);
  return json.access_token;
}

/** Táž pověření, jak je nesou proměnné prostředí. */
export function meshAuthFromEnv(env = process.env) {
  return {
    keycloakUrl:
      env.KEYCLOAK_PUBLIC_URL ||
      (env.KEYCLOAK_DOMAIN_PUBLIC ? `https://${env.KEYCLOAK_DOMAIN_PUBLIC}` : ""),
    realm: env.KEYCLOAK_REALM || "aisha",
    clientId: env.AISHA_BOOTSTRAP_CLIENT_ID || "aisha-bootstrap",
    clientSecret: env.AISHA_BOOTSTRAP_CLIENT_SECRET,
    username: env.AISHA_BOOTSTRAP_USERNAME || "aisha-bootstrap",
    password: env.AISHA_BOOTSTRAP_PASSWORD,
  };
}

/**
 * Vrátí tvář, která CESTU opravdu obsluhuje — ověřeným dotazem, ne domněnkou.
 *
 * ⛔ PROČ SDÍLENÁ (naměřeno 2026-08-27, znovu 2026-09-07). Veřejné jméno služby
 * (`netbird.<public-tld>`, `auth.<public-tld>`) posílá edge na uzel EDGE, jenže
 * netbird bydlí u pki — na jiném uzlu. Táž adresa proto odpovídá jinak podle
 * toho, kudy se jde:
 *
 *     netbird.<public-tld>/api/peers             → 404   (mluvím s CIZÍ službou)
 *     <prefix>-netbird.backend.<tld>/api/peers   → 401   (správná služba, chce token)
 *
 * ⭐ 404 VS 401 JE CELÁ DIAGNÓZA: 404 znamená „tady taková cesta není", tedy
 * špatný adresát; 401/403 znamená „obsluhuji a chci pověření", tedy správně
 * směrováno. Proto se živost pozná podle 200/401/403, ne podle 200.
 *
 * Tenhle pomocník žil v `netbird-peer-discover.mjs` a `netbird-dns-provision`
 * ho NEMĚL — volal veřejné jméno, dostal 404 a NEZAPSAL ANI JEDEN z 58 mesh
 * záznamů (`PLÁN (0 jmen)`), přičemž na chybějící peer mapu reagoval propadem
 * na docker alias, tedy na PLOCHOU SÍŤ — přesně ten stav, který má odstraňovat.
 * Táž lekce jako u tokenu o pár řádků výš: tři nástroje, tři vlastní cesty
 * k témuž API. Domov je jeden.
 *
 * NENÍ to fallback nad identitou: instance se nemění, mění se jen TVÁŘ, kterou
 * se k téže službě jde — a volba se OVĚŘÍ dotazem, nehádá se.
 *
 * @param {string} zvolena     adresa, kterou volající zvolil (např. NETBIRD_API_URL)
 * @param {string} primaDomena přímé jméno bez schématu (např. NETBIRD_DOMAIN_DIRECT)
 * @param {string} cesta       cesta, na které se živost zkouší (např. "/api/peers")
 * @param {string} popis       jméno služby do hlášky
 * @param {string} volajici    kdo se ptá — do hlášky, ať je vidět čí je to volba
 * @returns {Promise<string>}  adresa, která obsluhuje; při neúspěchu původní volba
 */
export async function tvarKteraObsluhuje(zvolena, primaDomena, cesta, popis, volajici = "netbird") {
  const zkus = async (url) => {
    if (!url) return 0;
    try {
      const r = await fetch(`${url.replace(/\/+$/, "")}${cesta}`, {
        method: "GET",
        signal: AbortSignal.timeout(15_000),
      });
      return r.status;
    } catch (e) {
      // NE tiché nula: „nešlo se spojit" je JINÝ nález než „služba odpověděla
      // 404". Bez téhle řádky by se nedosažitelná tvář tvářila jako špatná
      // adresa — a diagnóza by mířila o vrstvu vedle.
      console.error(`[${volajici}] ${popis}: ${url} nedosažitelná (${String(e?.message || e).split("\n")[0]})`);
      return 0;
    }
  };
  const zive = (k) => [200, 401, 403].includes(k);
  const kod = await zkus(zvolena);
  if (zive(kod)) return zvolena;
  if (!primaDomena) return zvolena;
  const prima = `https://${primaDomena}`;
  const kodPrimy = await zkus(prima);
  if (zive(kodPrimy)) {
    console.error(`[${volajici}] ${popis}: ${zvolena} → HTTP ${kod}; PŘÍMÁ tvář ${prima} → HTTP ${kodPrimy}, používám ji`);
    return prima;
  }
  console.error(`[${volajici}] ${popis}: ani ${zvolena} (HTTP ${kod}), ani ${prima} (HTTP ${kodPrimy}) neobsluhuje`);
  return zvolena;
}
