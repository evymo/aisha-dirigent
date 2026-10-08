import { createSsrfGuard } from '@aisha/security';

/**
 * Výstup z uzavřené sítě běhů pro claude_cli_task — výčet ODVOZENÝ Z KONFIGURACE.
 *
 * ⛔ 2026-10-06 (majitel „síť zavřít“ = volba A): běh Claude Code ve VM potřebuje volat
 * model, forge a registr balíčků — ale nic víc. Jediná cesta ven je CONNECT na broker-proxy
 * runneru (broker-proxy.ts) s tokenem běhu; projde jen hostitel:port z tohoto výčtu a jen
 * na VEŘEJNOU adresu (ochrana SSRF z @aisha/security: ne loopback, ne RFC1918, ne mesh
 * 100.64/10, ne metadata). Jediný vnitřní cíl běhu je broker (relé `/sandbox/*`).
 *
 * Hostitelé se berou z adres, které runner běhu sám předává (pravidlo „vše v env, bez
 * vendor lock-inu“): žádný výchozí hostitel dodavatele v kódu. Chybí-li adresa modelu,
 * běh se NESPUSTÍ — Claude Code by jinak šel na vestavěnou adresu dodavatele, kterou nikdo
 * nedeklaroval. Jen `https:` — proxy tuneluje TLS (CONNECT); prostý `http:` by tokeny
 * modelu a forge posílal nešifrovaně a brána ho nepouští (fail-closed při přípravě běhu).
 *
 * Hodnota proměnné se do chyby NEPÍŠE: adresa forge běžně nese token (`https://x:token@…`).
 */

export interface EgressTarget {
  /** Malými písmeny, jak ho vrací `URL.hostname`. */
  host: string;
  port: number;
}

/** Ověří cíl a vrátí IP, na kterou se smí spojit. Odmítnutí = výjimka. */
export type ResolveTarget = (target: EgressTarget) => Promise<string>;

export interface ZdrojCile {
  /** Jméno proměnné prostředí (do chybové hlášky). */
  promenna: string;
  url: string;
}

export interface ZdrojeEgressClaude {
  /** Adresa modelu podle režimu přihlášení (ANTHROPIC_BASE_URL / AGENT_LOCAL_LLM_URL) — povinná. */
  model: ZdrojCile;
  /** Relé dohledu (AGENT_GATEWAY_URL), forge (AGENT_GIT_REMOTE), registr (NPM_REGISTRY_URL) — jen jsou-li nastavené. */
  volitelne: ZdrojCile[];
}

/** Cíl z https URL. Jiné schéma (http, ssh forge) nebo nečitelná URL = výjimka. */
export function cilZUrl(zdroj: ZdrojCile): EgressTarget {
  let url: URL;
  try {
    url = new URL(zdroj.url);
  } catch {
    throw new Error(`${zdroj.promenna} není čitelná URL — běh má cestu ven jen přes broker-proxy runneru na deklarované https adresy`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(
      `${zdroj.promenna} není https URL (${url.protocol}) — běh má cestu ven jen tunelem TLS přes broker-proxy runneru (CONNECT)`,
    );
  }
  return { host: url.hostname.toLowerCase(), port: url.port ? Number(url.port) : 443 };
}

/** Výčet cílů pro claude_cli_task. Bez adresy modelu výjimka; duplicity pryč. */
export function claudeEgressTargets(zdroje: ZdrojeEgressClaude): EgressTarget[] {
  if (!zdroje.model.url.trim()) {
    throw new Error(
      `claude_cli_task: adresa modelu není deklarovaná (${zdroje.model.promenna}) — běh smí ven jen přes broker-proxy runneru ` +
        'na hostitele odvozené z konfigurace; vestavěnou adresu dodavatele proxy nepustí',
    );
  }
  const cile = [cilZUrl(zdroje.model)];
  for (const z of zdroje.volitelne) {
    if (z.url.trim()) cile.push(cilZUrl(z));
  }
  const videno = new Set<string>();
  return cile.filter((c) => {
    const klic = `${c.host}:${c.port}`;
    if (videno.has(klic)) return false;
    videno.add(klic);
    return true;
  });
}

/** URL tvar hostitele (IPv6 v hranatých závorkách už je z `URL.hostname`). */
function hostProUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

/**
 * Výchozí ověření cíle: ochrana SSRF z @aisha/security — jen veřejná adresa.
 * Výčet hostitelů už proxy zkontrolovala; tady se měří, KAM jméno vede.
 */
export const defaultResolveTarget: ResolveTarget = async (target) => {
  const guard = createSsrfGuard({
    service: 'svc-agent-runner:broker-proxy',
    hostAllowlist: [target.host],
    allowedSchemes: ['https:'],
    allowInternalNetworks: false,
  });
  const { ip } = await guard.check(`https://${hostProUrl(target.host)}:${target.port}/`);
  return ip;
};

/** `host:port` z CONNECT; nečitelné = null. */
export function cilConnect(autorita: string): EgressTarget | null {
  const m = autorita.match(/^(\[[0-9a-f:.]+\]|[a-z0-9.-]+):(\d{1,5})$/i);
  if (!m) return null;
  const port = Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: m[1]!.toLowerCase(), port };
}

/**
 * Změří VŠECHNY cíle běhu stejnou ochranou SSRF, jakou je pak pustí broker-proxy
 * (CONNECT) — už při přípravě běhu, s názvem proměnné v chybě. Výčet a ochrana SSRF jsou
 * tak jedno rozhodnutí: co tady projde, proxy pustí; co ne, běh se vůbec nespustí.
 *
 * ⛔ 2026-10-07 (revize D6): adresa modelu / relé / forge do meshe nebo na soukromou
 * adresu dřív prošla přípravou a běh padl až prvním voláním modelu („proč Claude neodpovídá“).
 */
export async function overVystupBehu(zdroje: ZdrojeEgressClaude, resolveTarget: ResolveTarget = defaultResolveTarget): Promise<void> {
  const vsechny = [zdroje.model, ...zdroje.volitelne.filter((z) => z.url.trim())];
  for (const zdroj of vsechny) {
    const cil = cilZUrl(zdroj);
    try {
      await resolveTarget(cil);
    } catch (e) {
      throw new Error(
        `${zdroj.promenna} vede na ${cil.host}:${cil.port}, kam broker-proxy běh nepustí ` +
          `(${e instanceof Error ? e.message : String(e)}) — běh smí ven jen na veřejné https adresy; běh se nespustí`,
      );
    }
  }
}
