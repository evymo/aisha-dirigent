/**
 * umisteni-sluzeb.mjs — kde instance služby SKUTEČNĚ nasazuje, a co z toho plyne.
 *
 * Čisté funkce bez CLI a bez čtení registru: registr slotů a katalog dostávají
 * jako argument. Bydlí tu kvůli derive-domains — ten je potřebuje, a modul
 * `sloty-serveru.mjs` (domov registru slotů) importovat nesmí: CLI sloty-serveru si
 * derive-domains načítá dynamicky (`loadProfile`) a statický import zpět by
 * vytvořil cyklus s top-level await (node exit 13, naměřeno 2026-10-05).
 * `sloty-serveru.mjs` tyto funkce re-exportuje — spotřebitelé se nemění.
 */
import { nactiKatalog, podminkaSplnena } from "./provision-gate.mjs";

/**
 * Slot, jehož server se NEHÁDÁ. Rozhoduje vlastnost slotu v registru (`has_gpu`),
 * ne jeho jméno: na GPU uzel patří i firewall hostitele (`accel-hostfw`), a kdyby
 * discovery GPU slot „spárovala" s jediným serverem v Coolify, přistál by ten
 * firewall na produkčním hostiteli. Takový slot potřebuje výslovnou vazbu.
 */
export function vyzadujeVyslovnouVazbu(slotDef) {
  return slotDef?.has_gpu === true;
}

/**
 * Nasazuje Coolify compose na slotu RAW (`is_raw_compose_deployment_enabled`)? Na slotu s GPU vždy.
 * Běžný parser Coolify v4 (bootstrap/helpers/parsers.php applicationParser) každé službě bez
 * `network_mode` přidá síť aplikace `<uuid>` (bridge s cestou ven), každé přidá `env_file: [.env]`
 * (všechny proměnné aplikace do každého kontejneru) a přepíše `container_name`. Na sdíleném uzlu by
 * tím VB a enginy dostaly cestu ven, stahovač vah klíč jádra a hlídač by nepoznal kontejnery.
 * Raw nasadí compose tak, jak je (Application::oldRawParser přidá jen štítky coolify.*), takže to,
 * co prošlo revizí a krokem 0, je přesně to, co běží. Vlastnost slotu, ne aplikace: druhý přepínač
 * by se mohl rozejít s `has_gpu`.
 */
export function nasazujeRaw(slotDef) {
  return slotDef?.has_gpu === true;
}

/**
 * Kde instance služby SKUTEČNĚ nasazuje: katalog + přepis profilu
 * (`service_overrides.<id>.placement`), bez služeb vyřazených profilem (`exclude`)
 * a bez zavřených lane. Bez profilu = umístění z katalogu.
 *
 * @returns {Map<string, string>} id služby → umístění
 */
export function efektivniUmisteni({ sluzby = nactiKatalog(), profil = null, cti } = {}) {
  const vyrazene = new Set(profil?.exclude ?? []);
  const prepisy = profil?.service_overrides ?? {};
  const vysledek = new Map();
  for (const [id, sluzba] of Object.entries(sluzby ?? {})) {
    if (!sluzba || vyrazene.has(id)) continue;
    if (!podminkaSplnena(sluzba.provision_when_env, cti)) continue;
    const umisteni = prepisy[id]?.placement ?? sluzba.placement;
    if (umisteni) vysledek.set(id, umisteni);
  }
  return vysledek;
}

/**
 * Compose, ze kterého se služba nasazuje na daném slotu: na slotu s výslovnou vazbou
 * (has_gpu, sdílený GPU uzel) její `compose_gpu` (tenký stack forku), jinak `compose`.
 * JEDINÝ domov volby — derivace topologie i krok 0 doktora (umisteni-slotu) čtou totéž.
 */
export function composeProUmisteni(sluzba, slot, servers) {
  if (sluzba?.compose_gpu && vyzadujeVyslovnouVazbu(servers?.[slot])) return sluzba.compose_gpu;
  return sluzba?.compose ?? null;
}

/**
 * Služba katalogu, jejíž umístění rozhoduje o modelovém meshi forku.
 */
export const SLUZBA_MODELU = "model";

/**
 * Slot modelového meshe forku (varianta C, aisha.decision 2026-10-05 03:17:54Z):
 * slot s výslovnou vazbou (`has_gpu`), na který instance klade svůj model —
 * přepis umístění v profilu, jinak katalog; model vyřazený profilem (`exclude`)
 * mesh nemá. Jinak "".
 *
 * Deklarací modelového meshe je SAMO umístění modelu. Druhý vypínač (příznak
 * v profilu) by se s umístěním mohl rozejít: model na GPU bez meshe by neměl
 * kudy ven, mesh bez modelu na GPU by byl řídicí rovina bez peeru.
 *
 * ⛔ OPRAVENO 2026-10-05 (krok 7): dřív se navíc vyžadovala otevřená lane modelu
 * (`CHAT_GGUF_URL` = URL CPU vah). Tenký stack na GPU uzlu ale GGUF nenese a fork,
 * který CPU váhy zrušil (rozhodnutí 10-03: „CPU modely úplně pryč“), by mesh nedostal nikdy.
 * Model na GPU slotu se proto zakládá přes lane MODEL_MESH (katalog: CHAT_GGUF_URL
 * NEBO MODEL_MESH), kterou otevírá právě tohle umístění.
 *
 * @returns {string} jméno slotu, nebo "" (instance modelový mesh nemá)
 */
export function slotModelovehoMeshe({ servers, sluzby = nactiKatalog(), profil = null } = {}) {
  if (!servers || typeof servers !== "object") {
    // Bez registru by každý slot vyšel „bez has_gpu" a mesh by tiše zmizel.
    throw new Error("slotModelovehoMeshe: chybí registr slotů (coolify/servers.json → servers)");
  }
  if (!sluzby?.[SLUZBA_MODELU] || (profil?.exclude ?? []).includes(SLUZBA_MODELU)) return "";
  const slot = profil?.service_overrides?.[SLUZBA_MODELU]?.placement ?? sluzby[SLUZBA_MODELU].placement;
  return slot && vyzadujeVyslovnouVazbu(servers?.[slot]) ? slot : "";
}

/**
 * Čtenář lane, ve kterém `MODEL_MESH` ODVOZUJE umístění modelu (slotModelovehoMeshe) —
 * prostředí ho nepřebije (operátor přepíná umístění, ne lane). Jeden domov pro
 * derivaci topologie i pro CLI slotů (slotyVProvozu, umisteniBezWarmupu), aby obě
 * strany viděly model na GPU slotu stejně.
 */
export function ctiSModelovymMeshem({ servers, sluzby = nactiKatalog(), profil = null, cti = (k) => process.env[k] } = {}) {
  const mesh = slotModelovehoMeshe({ servers, sluzby, profil });
  return (k) => (k === "MODEL_MESH" ? mesh : cti(k));
}
