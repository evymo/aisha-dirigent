/*
 * Stav služeb na přihlašovací stránce — progresivní vylepšení, nic víc.
 *
 * Monitoring UŽ existuje (gateway `/api/health` sonduje upstreamy a vrací po
 * komponentách ok / http_NNN / unreachable + latenci) — tenhle soubor ho jen
 * PŘEDÁVÁ do kontrolek `es-lamp` v uvítacím sloupci.
 *
 * Zásady:
 *  - Stránka na tom NESMÍ záviset. Bez adresy, bez odpovědi, při timeoutu nebo
 *    zamítnutém CORS zůstanou kontrolky neutrální. Žádný retry, žádná chyba do
 *    konzole: přihlášení je statická stránka, která se umí dat chytit, ne
 *    stránka, která na nich stojí.
 *  - Adresa NENÍ v kódu. Bere se z `data-status-endpoint` na <body>, kam ji
 *    šablona píše z message klíče `loginStatusEndpoint` — tedy z instančního
 *    kanálu. Platforma ho má prázdný, takže generický build nikam nevolá.
 *  - `state` je slovník ESDK (ok | wait | fault), ne vlastní vynález.
 *  - `/api/health` vrací 503, když je cokoli degradované; to pro nás není
 *    chyba přenosu, ale platná odpověď — JSON se čte bez ohledu na status.
 *  - Ukazuje se JEDEN AGREGOVANÝ příznak, ne kontrolka na subsystém. Stránku
 *    vidí i nepřihlášený; ten nepotřebuje vědět, z čeho je systém složený,
 *    jen jestli běží. Dřív tu byly tři kontrolky pojmenované po komponentách
 *    a instanční overlay je přepsal na produktová jména — expozice, kterou
 *    agregace řeší v mechanismu, ne v hodnotě.
 *  - Bez dat zůstane příznak neutrální; předstírat zelenou by bylo horší než
 *    neukázat nic.
 *
 * Pozor při nasazení: doména přihlašovací stránky musí být v `ALLOWED_ORIGINS`
 * gateway, jinak prohlížeč odpověď zahodí a kontrolky zůstanou neutrální.
 */
(() => {
  "use strict";

  const raw = document.body && document.body.getAttribute("data-status-endpoint");
  // FreeMarker vrací jméno klíče, když v bundlu není — takový „endpoint"
  // není adresa, ale chybějící překlad.
  const endpoint =
    raw && raw.indexOf("://") > -1 && raw !== "loginStatusEndpoint" ? raw : "";

  const lamp = document.querySelector("[data-status-aggregate]");
  if (!endpoint || !lamp || !("fetch" in window)) return;

  fetch(endpoint, { signal: AbortSignal.timeout(3000), credentials: "omit" })
    .then((res) => res.json())
    .then((body) => {
      // Endpoint vydává AGREGÁT, ne složení: `{"status":"healthy"|"degraded"}`.
      // Do 2026-08-03 se tu četlo `body.upstreams` a skládal se z něj nejhorší
      // stav — jenže tak vypadala odpověď PŘED zjednodušením v #107, které
      // schválně přestalo vydávat jména podsystémů nepřihlášenému. Obě změny
      // šly stejnou noc a rozešly se: fetch prošel, `upstreams` chybělo, funkce
      // tiše skončila na `if (!up) return` a příznak zůstal navždy na
      // „zjišťuje se". Naměřeno na nasazené stránce po opravě CORS (#115):
      // volání 165 ms / 200, a lampa se přesto nezměnila.
      //
      // Skládat nejhorší stav z komponent už není naše práce — dělá to gateway
      // a vydá jedno slovo. Tady se jen překládá do slovníku ESDK.
      const raw = body && typeof body.status === "string" ? body.status : null;
      // Bez čitelného stavu se nic netvrdí — neutrální je platný stav.
      if (!raw) return;
      const stav = raw === "healthy" ? "ok" : raw === "degraded" ? "wait" : "fault";
      lamp.setAttribute("state", stav);
      const popisek = lamp.querySelector("[data-status-label]");
      if (popisek) {
        popisek.textContent =
          lamp.getAttribute(stav === "ok" ? "data-label-ok" : "data-label-degraded") ||
          popisek.textContent;
      }
    })
    .catch(() => {
      /* ticho — neutrální kontrolky jsou navržený stav bez dat */
    });
})();
