/**
 * modelovy-mesh-posudek.mjs — posudek modelového meshe forku (varianta C, krok C5).
 *
 * Čistá funkce: dostane to, co vrátilo API managementu MODELOVÉHO meshe (peery, politiky,
 * skupiny), a deklarace instance (jména peerů, připnutá id, IP uzlu doručenou mostu, port
 * modelu). Nic nevolá a nic nemění — měřidlo, které jde otestovat bez sítě. Volá ho
 * `scripts/modelovy-mesh-doktor.mjs` (fáze N cold-start doktora).
 *
 * Co je vada (rc 1):
 *   · ve skupině uzlu / mostu peer s cizím jménem nebo jiným než připnutým id (incident);
 *   · deklarovaný peer chybí, není připnutý, nebo je NEPŘIPOJENÝ — modelové funkce stojí
 *     (žádný návrat na CPU ani jiný model, MM8);
 *   · most míří na jinou IP, než má uzel (nebo ji nemá doručenou);
 *   · politika není PRÁVĚ jedna most → uzel, tcp/port modelu, jednosměrně.
 * Seznam, který není pole (chybová odpověď API), = NEZMĚŘENO (rc 2) — nikdy „nic tam není“.
 */

const idOf = (x) => (x && typeof x === "object" ? x.id : x);

export function posudekModelovehoMeshe({ peery, politiky, skupiny, env = {} }) {
  if (![peery, politiky, skupiny].every(Array.isArray)) {
    return {
      rc: 2,
      verdikty: [{ co: "API", stav: "nezmereno", detail: "seznam z API managementu není pole (chybová odpověď?) — nic se neposuzuje" }],
    };
  }
  const verdikty = [];
  const ok = (co, detail) => verdikty.push({ co, stav: "ok", detail });
  const vada = (co, detail) => verdikty.push({ co, stav: "vada", detail });

  const role = [
    { klic: "uzel", popis: "uzel na GPU slotu", skupina: "model-gpu", jmeno: env.MODEL_MESH_GPU_PEER, pin: env.MODEL_MESH_GPU_PEER_ID },
    { klic: "most", popis: "most", skupina: "model-most", jmeno: env.MODEL_MESH_MOST_PEER, pin: env.MODEL_MESH_MOST_PEER_ID },
  ];
  const idSkupin = {};
  const peerRole = {};
  for (const r of role) {
    const g = skupiny.filter((s) => s?.name === r.skupina);
    if (g.length !== 1) {
      vada(r.popis, `skupin '${r.skupina}' je ${g.length} (čekám právě jednu)`);
      continue;
    }
    idSkupin[r.skupina] = g[0].id;
    if (!r.jmeno) {
      vada(r.popis, "jméno peeru není deklarované — derivace modelového meshe se nedoručila");
      continue;
    }
    const vSkupine = peery.filter((p) => (p?.groups ?? []).some((x) => idOf(x) === g[0].id));
    const cizi = vSkupine.filter((p) => p?.name !== r.jmeno || (r.pin && p?.id !== r.pin));
    if (cizi.length > 0) {
      vada(r.popis, `ve skupině ${r.skupina} je CIZÍ peer: ${cizi.map((p) => `${p?.name}/${p?.id}`).join(", ")} — incident, bootstrap ho odebere a zastaví`);
      continue;
    }
    if (vSkupine.length !== 1) {
      vada(r.popis, vSkupine.length === 0 ? `'${r.jmeno}' v modelovém meshi NENÍ` : `víc peerů '${r.jmeno}' — nerozhodnutelné`);
      continue;
    }
    const p = vSkupine[0];
    if (!r.pin) {
      vada(r.popis, `'${r.jmeno}' (id ${p.id}) není připnutý — spusť bootstrap modelového meshe`);
      continue;
    }
    if (p.connected !== true) {
      vada(r.popis, `'${r.jmeno}' je v meshi, ale NEPŘIPOJENÝ (last_seen ${p.last_seen ?? "?"}) — modelové funkce stojí (žádný návrat na CPU)`);
      continue;
    }
    ok(r.popis, `'${r.jmeno}' připojený, připnuté id ${p.id}, IP ${p.ip ?? "?"}`);
    peerRole[r.klic] = p;
  }

  if (peerRole.uzel) {
    const dorucena = env.MODEL_MESH_GPU_PEER_IP ?? "";
    if (!dorucena) vada("cíl mostu", "MODEL_MESH_GPU_PEER_IP nedoručena — most odpovídá 503 LANE_NEDOSTUPNA");
    else if (dorucena !== peerRole.uzel.ip) {
      vada("cíl mostu", `most míří na ${dorucena}, uzel má ${peerRole.uzel.ip} — bootstrap modelového meshe doručí IP, pak přenasadit most`);
    } else ok("cíl mostu", `most míří na IP uzlu ${dorucena}`);
  }

  const port = String(env.MODEL_MESH_PORT ?? "");
  const politika = politiky.length === 1 ? politiky[0] : null;
  const pravidlo = politika?.rules?.length === 1 ? politika.rules[0] : null;
  const sedi =
    politika?.enabled === true && pravidlo?.enabled === true && pravidlo.action === "accept" &&
    pravidlo.bidirectional === false && pravidlo.protocol === "tcp" &&
    JSON.stringify(pravidlo.ports ?? []) === JSON.stringify([port]) &&
    Boolean(idSkupin["model-most"]) && Boolean(idSkupin["model-gpu"]) &&
    JSON.stringify((pravidlo.sources ?? []).map(idOf)) === JSON.stringify([idSkupin["model-most"]]) &&
    JSON.stringify((pravidlo.destinations ?? []).map(idOf)) === JSON.stringify([idSkupin["model-gpu"]]);
  if (sedi) ok("politika", `jediná: most → uzel, tcp/${port}, jednosměrně`);
  else vada("politika", `čekám PRÁVĚ jednu politiku most → uzel tcp/${port} jednosměrně; politik je ${politiky.length} — mesh může být otevřenější, než smí`);

  return { rc: verdikty.some((v) => v.stav === "vada") ? 1 : 0, verdikty };
}
