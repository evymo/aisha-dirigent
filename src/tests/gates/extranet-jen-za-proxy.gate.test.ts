/**
 * Brána: veřejný extranet je dosažitelný JEN přes oauth2-proxy.
 *
 * Zadání majitele 2026-08-03/04: „extranet nesmí být přístupný a nic z něj
 * zbytečně". Klientská brána (`extranet-nema-nepihlaseny-pobyt`) na to nestačí —
 * ta běží až v prohlížeči, takže bundle je v tu chvíli vydaný a dá se z něj
 * přečíst struktura sekcí i jména RPC.
 *
 * PROČ V EDGE STACKU, A NE U POVRCHU (naměřeno 2026-08-04)
 * instanční extranet je v Coolify `build_pack: dockerfile` a staví se z JINÉHO
 * repozitáře (`provision-surfaces.sh` → `git_repository: $AISHA_SURFACE_REPO`).
 * Jeho `docker-compose.coolify-extranet.yml` se tedy nepoužívá a v jeho
 * zdrojovém stromu ani není — sidecar u povrchu by byl mrtvá konfigurace,
 * která vypadá jako ochrana. Veřejný provoz teče přes edge, takže brána
 * patří tam.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const ROOT = process.cwd();
const EDGE = join(ROOT, "docker-compose.coolify-prebuilt.yml");
const SURFACE = join(ROOT, "docker-compose.coolify-extranet.yml");

interface ComposeService {
  image?: string;
  labels?: string[];
  environment?: Record<string, string>;
  networks?: string[];
  profiles?: string[];
}
interface Compose {
  services: Record<string, ComposeService>;
}

const edgeRaw = readFileSync(EDGE, "utf8");
const edge = parse(edgeRaw) as Compose;
const gate = edge.services["extranet-auth"];

describe("Extranet: veřejná cesta jen přes bránu (gate)", () => {
  test("brána je v edge stacku a je to oauth2-proxy", () => {
    expect(gate, "edge stack nemá službu extranet-auth").toBeTruthy();
    expect(String(gate.image)).toMatch(/oauth2-proxy/);
  });

  test("brána nemá vlastní veřejný router — pouští ji edge", () => {
    const labels: string[] = gate.labels ?? [];
    expect(labels.filter((l) => /routers\..*\.rule=Host\(/.test(l))).toEqual([]);
  });

  /** Úsek entrypointu, ve kterém se staví extranet route. */
  function routeRegion(): string {
    const from = edgeRaw.indexOf('extranet_block=""');
    expect(from, "v entrypointu chybí stavba extranet route").toBeGreaterThan(-1);
    const to = edgeRaw.indexOf("gateway.", from);
    return edgeRaw.slice(from, to > from ? to : from + 4000);
  }

  test("edge se zapnutou bránou NESMÍ směrovat na povrch přímo", () => {
    // Route se musí rozhodovat podle vlajky a při zapnuté bráně mířit na ni.
    // Kdyby zůstalo jen EXTRANET_UPSTREAM, edge by bránu obešel a povrch by byl
    // otevřený — a vypadal by přitom naprosto zdravě.
    const region = routeRegion();
    expect(region).toMatch(/EXTRANET_AUTH_GATE/);
    // CÍL směrování, ne jen výskyt řetězce. `extranet-auth:4180` je v úseku
    // dvakrát — podruhé v healthchecku `wget …/ping` — a volnější tvrzení
    // („obsahuje ten řetězec") prošlo i po rozbití cíle. Naměřeno sondou
    // 2026-08-04: brána by tak nechytila přesně tu regresi, kvůli které je.
    expect(region).toContain("reverse_proxy http://extranet-auth:4180");
    // Přímá cesta na povrch smí existovat JEN ve větvi s vypnutou bránou.
    const primo = region.indexOf("$${EXTRANET_UPSTREAM}");
    const vlajka = region.indexOf("EXTRANET_AUTH_GATE");
    expect(vlajka, "vlajka se musí testovat DŘÍV než přímá cesta").toBeLessThan(primo);
  });

  test("fail-closed: nedostupná brána route NEZAPNE", () => {
    // Opačné pořadí („nejde brána, pusť provoz přímo") je tichá degradace:
    // povrch běží dál, jen je otevřený.
    expect(edgeRaw).toMatch(/extranet-auth:4180\/ping/);
    expect(edgeRaw).toMatch(/route VYPNUTA/);
  });

  test("brána neukazuje vlastní mezistránku a nemá výjimky z autentizace", () => {
    const env = gate.environment ?? {};
    expect(String(env.OAUTH2_PROXY_SKIP_PROVIDER_BUTTON)).toBe("true");
    expect(Object.keys(env).filter((k) => /SKIP_AUTH/.test(k))).toEqual([]);
  });

  test("prohlížeč se vrací na VEŘEJNOU adresu, ne na vnitřní", () => {
    const redirect = String(gate.environment?.OAUTH2_PROXY_REDIRECT_URL ?? "");
    expect(redirect).toContain("EXTRANET_DOMAIN_PUBLIC");
    expect(redirect).not.toMatch(/\$\{EXTRANET_DOMAIN[:}]/);
  });

  test("compose povrchu nepředstírá ochranu, kterou nenasadí", () => {
    // Povrch je Dockerfile appka z jiného repa — oauth2-proxy zapsaná sem by
    // se nikdy nenasadila a čtenáře by uklidnila falešně.
    const surface = parse(readFileSync(SURFACE, "utf8")) as Compose;
    const proxies = Object.entries(surface.services)
      .filter(([, s]) => /oauth2-proxy/.test(String(s.image ?? "")))
      .map(([n]) => n);
    expect(proxies).toEqual([]);
  });
});
