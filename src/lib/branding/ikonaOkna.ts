/**
 * Ikona okna (favicon) instance z profilu brandingu.
 *
 * ⛔ NAMĚŘENO 2026-10-02 (na instanci): index.html nese DVĚ ikony platformy —
 * `favicon.ico` a `favicon.png` — a nastavení přepisovalo jen první. Druhá
 * (ikona AISHA) zůstala a prohlížeč si mohl vybrat ji; `type` navíc pořád tvrdil
 * `image/x-icon`, i když šlo o PNG. A `?v=Date.now()` stahovalo ikonu při každém
 * načtení znovu, přestože úložiště ji posílá jako `immutable`.
 *
 * Teď se nastaví VŠECHNY `<link rel="icon">` na ikonu instance se správným typem
 * a u rastrové ikony i `apple-touch-icon` (ikona na ploše telefonu). Cache-bust
 * nese verze profilu — mění se jen, když se profil změní.
 */

const TYPY: Record<string, string> = {
  ico: "image/x-icon",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
};

/** MIME podle přípony adresy (bez query a fragmentu); neznámá → null. */
export function typIkony(adresa: string): string | null {
  const cesta = adresa.split(/[?#]/)[0];
  const tecka = cesta.lastIndexOf(".");
  if (tecka < 0 || tecka < cesta.lastIndexOf("/")) return null;
  return TYPY[cesta.slice(tecka + 1).toLowerCase()] ?? null;
}

/** Adresa s verzí pro cache-bust (zachová existující query). */
export function sVerzi(adresa: string, verze: string | number | null | undefined): string {
  if (verze === null || verze === undefined || verze === "") return adresa;
  const [bezFragmentu, fragment] = adresa.split("#", 2);
  const oddelovac = bezFragmentu.includes("?") ? "&" : "?";
  return `${bezFragmentu}${oddelovac}v=${encodeURIComponent(String(verze))}${fragment ? `#${fragment}` : ""}`;
}

/**
 * Nastaví ikonu okna dokumentu na `adresa`.
 *
 * @param doc - dokument (v testu jsdom)
 * @param adresa - veřejná adresa ikony z profilu (`favicon_path`)
 * @param verze - verze profilu pro cache-bust
 */
export function nastavIkonuOkna(doc: Document, adresa: string, verze?: string | number | null): void {
  const href = sVerzi(adresa, verze);
  const typ = typIkony(adresa);

  const odkazy = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
  if (odkazy.length === 0) {
    const novy = doc.createElement("link");
    novy.rel = "icon";
    doc.head.appendChild(novy);
    odkazy.push(novy);
  }
  for (const odkaz of odkazy) {
    odkaz.href = href;
    if (typ) odkaz.type = typ;
    else odkaz.removeAttribute("type");
    odkaz.removeAttribute("sizes");
  }

  // Ikona na plochu telefonu umí jen rastr (iOS SVG nebere).
  if (typ && typ !== "image/svg+xml" && typ !== "image/x-icon") {
    const dotyk = doc.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    if (dotyk) dotyk.href = href;
  }
}
