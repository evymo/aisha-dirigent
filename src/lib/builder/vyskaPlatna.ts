import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Výška plátna editoru se odvozuje z VIDITELNÉ PLOCHY okna — ne z konstanty.
 *
 * ⛔ NAMĚŘENO 2026-09-14 na produkci (okno 1470 × 437 CSS px, DPR 2):
 *
 *     div.gjs-editor-wrapper      1570 px  ← inline height:100% z @grapesjs/react
 *     div.gjs-editor-cont          150 px  ← procenta z rodiče BEZ definitní výšky
 *     iframe.gjs-frame             150 px  ← tovární výška <iframe>
 *
 * Pravidlo `.gjs-editor-wrapper { height: calc(100vh - 16rem) }` v index.css
 * nikdy neplatilo: inline styl knihovny ho přebije. A kdyby platilo, pořád
 * by to byl odhad — 16rem je výška hlavičky na JEDNOM displeji. Na okně
 * vysokém 437 px zabírala administrace nad plátnem 329 px.
 *
 * Proto se měří: kde plátno na stránce skutečně začíná a kolik je vidět.
 */
export type RezimVysky =
  /** plátno se vejde pod hlavičku administrace a zabere zbytek okna */
  | "pod-hlavickou"
  /** pod hlavičkou by zbylo málo — editor (lišta + plátno) vyplní celé okno */
  | "editor-pres-okno";

export interface VstupVysky {
  /** výška viditelné plochy okna (visualViewport, jinak innerHeight) */
  vyskaOkna: number;
  /** horní okraj plátna v souřadnicích DOKUMENTU (rect.top + scrollY) */
  horniOkrajPlatna: number;
  /** horní okraj celého editoru (lišta nástrojů) v souřadnicích dokumentu */
  horniOkrajEditoru: number;
  /** spodní odsazení obalu, aby se plátno nelepilo na hranu okna */
  spodniOdsazeni: number;
}

/**
 * Když se plátno vejde pod hlavičku tak, že zabere aspoň polovinu okna,
 * zůstane hlavička vidět. Jinak (nízké okno, otevřený panel verzí) by plátno
 * byl proužek — pak se editor posune k horní hraně a vyplní okno celé.
 * Polovina je poměr k displeji, ne rozměr: platí stejně na 437 i 1440 px.
 */
export function spoctiVyskuPlatna(v: VstupVysky): { vyska: number; rezim: RezimVysky } {
  const podHlavickou = Math.floor(v.vyskaOkna - v.horniOkrajPlatna - v.spodniOdsazeni);
  if (podHlavickou >= v.vyskaOkna / 2) {
    return { vyska: podHlavickou, rezim: "pod-hlavickou" };
  }
  const nadPlatnem = v.horniOkrajPlatna - v.horniOkrajEditoru;
  return {
    vyska: Math.max(0, Math.floor(v.vyskaOkna - nadPlatnem - v.spodniOdsazeni)),
    rezim: "editor-pres-okno",
  };
}

/**
 * Drží výšku plátna v souladu s oknem: přepočet při změně velikosti okna,
 * zoomu (visualViewport) i při změně rozložení editoru (ResizeObserver —
 * např. rozbalený panel verzí posune plátno níž).
 */
export function useVyskaPlatna(
  editorRef: RefObject<HTMLElement>,
  platnoRef: RefObject<HTMLElement>,
): number | undefined {
  const [vyska, setVyska] = useState<number>();
  const posunutoRef = useRef(false);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    const platno = platnoRef.current;
    if (!editor || !platno) return;

    const zmer = () => {
      const posun = window.scrollY;
      const obal = editor.closest("main");
      const odsazeni = obal ? Number.parseFloat(getComputedStyle(obal).paddingBottom) : Number.NaN;
      const vysledek = spoctiVyskuPlatna({
        vyskaOkna: window.visualViewport?.height ?? window.innerHeight,
        horniOkrajPlatna: platno.getBoundingClientRect().top + posun,
        horniOkrajEditoru: editor.getBoundingClientRect().top + posun,
        spodniOdsazeni: Number.isFinite(odsazeni) ? odsazeni : 0,
      });
      setVyska(vysledek.vyska);
      // Posun jen jednou: uživatel pak smí stránku posouvat sám.
      if (vysledek.rezim === "editor-pres-okno" && !posunutoRef.current) {
        posunutoRef.current = true;
        editor.scrollIntoView({ block: "start" });
      }
    };

    zmer();
    const pozorovatel = new ResizeObserver(zmer);
    pozorovatel.observe(editor);
    window.addEventListener("resize", zmer);
    window.visualViewport?.addEventListener("resize", zmer);
    return () => {
      pozorovatel.disconnect();
      window.removeEventListener("resize", zmer);
      window.visualViewport?.removeEventListener("resize", zmer);
    };
  }, [editorRef, platnoRef]);

  return vyska;
}
