import { useMemo, type ReactNode } from 'react';

/** Jezdec na trati: kde je (0…1 po okruhu), jak se jmenuje a v jakém je stavu. */
export interface CircuitMarker {
  /** Poloha na okruhu: 0 = start/cíl, 1 = celé kolo. Hodnoty mimo se zabalí. */
  pos: number;
  /** Popisek u jezdce (číslo běhu, zkratka). Vynech, když se jich sejde moc. */
  label?: ReactNode;
  /**
   * Stav jezdce. Názvy tónů jsou ZÁMĚRNĚ totožné s rezervovanými tokeny jazyka
   * (`--gain`, `--loss`, `--warning`, `--info`) — vymyšlený tón se pak pozná
   * podle jména, ne až podle barvy. Naměřeno: `is-ok` mířilo na `var(--ok)`,
   * který v jazyce není, takže splněný cíl tiše vyšel akcentem místo gainu.
   */
  tone?: 'gain' | 'loss' | 'warning' | 'info' | 'muted';
  /** Delší popis pro odečet a pro čtečku obrazovky. */
  title?: string;
}

export interface CircuitProps {
  markers: ReadonlyArray<CircuitMarker>;
  /** Kolik sektorových rysek rozdělit po trati (počet kroků procesu). */
  sectors?: number;
  /** Popis celého obrázku pro čtečku — co ten okruh vlastně ukazuje. */
  ariaLabel: string;
  children?: ReactNode;
}

/** Tvar trati z návrhu — rovinky a zatáčky, ne elipsa (viz komentář u komponenty). */
const TRACK =
  'M 30 68 L 66 68 Q 76 68 74 58 L 70 42 Q 68 32 56 34 L 36 38 Q 26 40 27 52 Z';

/**
 * Dráha navzorkovaná na body — BEZ DOM.
 *
 * Dřív se poloha měřila `getPointAtLength` v `useEffect`. Vypadalo to elegantně,
 * ale znamenalo to, že při PRVNÍM vykreslení je okruh PRÁZDNÝ a při statickém
 * renderu (server, test) na něm nikdy nikdo nestojí — trať bez jezdců vypadá
 * jako „žádné běhy", ne jako chyba. Naměřeno testem: vyrenderovaná trať bez
 * jediného markeru.
 *
 * Křivka je konstanta, takže se dá vzorkovat čistým výpočtem jednou pro vždy:
 * kubické/kvadratické segmenty po malých krocích, délky se sečtou a poloha 0…1
 * se pak dohledá lineární interpolací. Deterministické, testovatelné, bez
 * prohlížeče.
 */
function vzorkujDrahu(d: string): { x: number; y: number; t: number }[] {
  const tok = d.match(/[MLQZ]|-?[\d.]+/g) ?? [];
  const body: { x: number; y: number }[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  const kvadr = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) => {
    for (let k = 1; k <= 12; k++) {
      const t = k / 12;
      const u = 1 - t;
      body.push({ x: u * u * x0 + 2 * u * t * x1 + t * t * x2,
                  y: u * u * y0 + 2 * u * t * y1 + t * t * y2 });
    }
  };
  while (i < tok.length) {
    const c = tok[i++];
    if (c === 'M') { cx = Number(tok[i++]); cy = Number(tok[i++]); sx = cx; sy = cy; body.push({ x: cx, y: cy }); }
    else if (c === 'L') { cx = Number(tok[i++]); cy = Number(tok[i++]); body.push({ x: cx, y: cy }); }
    else if (c === 'Q') {
      const x1 = Number(tok[i++]); const y1 = Number(tok[i++]);
      const x2 = Number(tok[i++]); const y2 = Number(tok[i++]);
      kvadr(cx, cy, x1, y1, x2, y2); cx = x2; cy = y2;
    } else if (c === 'Z') { body.push({ x: sx, y: sy }); }
  }
  // Kumulativní délka → parametr 0…1. Bez ní by se poloha měřila po VZORCÍCH,
  // takže hustě navzorkovaná zatáčka by „trvala" stejně dlouho jako celá rovinka
  // a 50 % běhu by neleželo v polovině trati.
  let celkem = 0;
  const delky: number[] = [0];
  for (let k = 1; k < body.length; k++) {
    const p = body[k]!;
    const q = body[k - 1]!;
    celkem += Math.hypot(p.x - q.x, p.y - q.y);
    delky.push(celkem);
  }
  return body.map((b, k) => ({ ...b, t: celkem ? delky[k]! / celkem : 0 }));
}

const DRAHA = vzorkujDrahu(TRACK);
const START = DRAHA[0] ?? { x: 0, y: 0, t: 0 };

/** Bod na trati pro polohu 0…1 — lineární interpolace mezi vzorky. */
function bodNaTrati(pos: number): { x: number; y: number } {
  const t = ((pos % 1) + 1) % 1;
  for (let i = 1; i < DRAHA.length; i++) {
    const b = DRAHA[i]!;
    if (b.t >= t) {
      const a = DRAHA[i - 1]!;
      const u = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    }
  }
  return { x: START.x, y: START.y };
}

export const Circuit = ({ markers, sectors = 0, ariaLabel, children }: CircuitProps) => {
  const body = useMemo(() => markers.map((m) => bodNaTrati(m.pos)), [markers]);
  const rysky = useMemo(
    () => (sectors > 0 ? Array.from({ length: sectors }, (_, i) => bodNaTrati(i / sectors)) : []),
    [sectors]
  );

  return (
    <div className="rdl-circuit">
      <svg viewBox="0 0 100 100" role="img" aria-label={ariaLabel}>
        {/* Krajnice pod tratí dává hloubku a odděluje trať od pozadí karty. */}
        <path d={TRACK} className="rdl-circuit__verge" />
        <path d={TRACK} className="rdl-circuit__track" />
        {/* Start/cíl: bez něj se nepozná, odkud se počítá — a „skoro hotovo“
            vypadá stejně jako „právě odstartoval“. */}
        <line x1="30" y1="64.5" x2="30" y2="71.5" className="rdl-circuit__start" />
        {/* Sektorové rysky = kroky procesu. Kreslí se z POČTU kroků, takže proces
            o třech krocích dostane tři a o osmi osm — renderer žádný počet nezná. */}
        {rysky.map((p, i) => (
          <circle key={`s${i}`} cx={p.x} cy={p.y} r={1.1} className="rdl-circuit__tick" />
        ))}
        {body.map((p, i) => {
          const m = markers[i];
          return (
            <g key={i} className={`rdl-circuit__car is-${m?.tone ?? 'muted'}`}>
              {m?.title ? <title>{m.title}</title> : null}
              <circle cx={p.x} cy={p.y} r={3.2} />
              {m?.label ? (
                <text x={p.x} y={p.y - 5} textAnchor="middle">
                  {m.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {children}
    </div>
  );
};
