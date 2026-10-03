import { useMemo, useState, type ReactNode } from 'react';

export interface DataTableColumn {
  /** Key into each row object. */
  key: string;
  /** Column header text. */
  header: ReactNode;
  /** Right-align and use tabular mono numerals — for figures and deltas. */
  numeric?: boolean;
}

export interface DataTableProps {
  /** Column definitions, left to right. */
  columns: ReadonlyArray<{ key: string; header: ReactNode; numeric?: boolean }>;
  /** Rows; each maps a column `key` to its cell content (text, a `StatusChip`, a `Delta`, …). */
  rows: ReadonlyArray<Record<string, ReactNode>>;
  /**
   * Open the record behind a row. Given, rows become real controls — pointer
   * cursor, hover, focusable, Enter/Space — because a row that opens a detail
   * on click but cannot be reached by keyboard is a table only a mouse can read.
   * Omit for a read-only table.
   */
  onRowSelect?: (index: number) => void;
  /**
   * Turn header clicks into sorting. On by default: a register of hundreds of rows
   * arrives in ONE order chosen by the backend, and the question the reader brings
   * ("who owes longest", "which are unpaid") is rarely that order. Set false where
   * the given order IS the message — a timeline, a ranking.
   */
  sortable?: boolean;
}

/** Holé číslo po odstranění formátování. Bez vnořeného kvantifikátoru — lint na ně
 *  (oprávněně) hlídá zpětné navracení; tenhle tvar má lineární průchod. */
const NUMERIC = /^-?[0-9]+(?:[.][0-9]+)?$/;

/** Buňka převedená na něco porovnatelného — podle toho, co čtenář vidí. */
function sortKey(cell: ReactNode): string | number {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'number') return cell;
  if (typeof cell === 'string') {
    // Čísla se musí řadit jako čísla, ne jako text — jinak „1 000" < „9" a sloupec
    // s částkami je k ničemu. Odstraní se formátování (mezery včetně nedělitelné
    // a úzké, desetinná čárka); co po něm nezbude číslo, zůstává textem.
    const bare = cell.replace(/[\s\u00A0\u202F]/g, '').replace(',', '.');
    if (bare !== '' && NUMERIC.test(bare)) return Number(bare);
    return cell.toLocaleLowerCase();
  }
  return '';
}

/**
 * DataTable — the dense workhorse of the cockpit. Sticky-styled header, hairline
 * rows, tabular mono numerals right-aligned. Compose `StatusChip`/`Delta` into cells.
 * Pass `onRowSelect` to drill into a record; click a header to sort.
 *
 * Řadí se na tom, co UŽ JE NA OBRAZOVCE — nikdy se nedotazuje znovu. Díky tomu
 * zůstává poctivé ke svému rozsahu: přeskládá řádky, které backend poslal, a
 * tabulka s prvními 50 z 500 zůstane prvními 50. Cokoli jiného by znamenalo, že
 * kliknutí tiše mění, NA CO se člověk dívá.
 */
export const DataTable = ({ columns, rows, onRowSelect, sortable = true }: DataTableProps) => {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const order = useMemo(() => {
    const idx = rows.map((_, i) => i);
    if (!sort) return idx;
    // Řadí se INDEXY, ne řádky: `onRowSelect` dostává pozici v PŮVODNÍM poli, takže
    // kliknutí otevře ten záznam, na který uživatel klikl — i po přeřazení.
    return idx.sort((a, b) => {
      const x = sortKey(rows[a]?.[sort.key]);
      const y = sortKey(rows[b]?.[sort.key]);
      if (x === y) return a - b; // stabilní: při shodě drží původní pořadí
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * sort.dir;
      return String(x).localeCompare(String(y), undefined, { numeric: true }) * sort.dir;
    });
  }, [rows, sort]);

  // Tři stavy, ne dva: vzestupně → sestupně → ZPĚT NA PŮVODNÍ. Pořadí z backendu
  // něco znamená (nejnovější, nejdlužnější) a musí jít vrátit bez přenačtení.
  const toggle = (key: string): void =>
    setSort((cur) =>
      cur?.key === key ? (cur.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }
    );

  return (
    <div className="rdl-tablewrap">
      <table className="rdl-table">
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const aria = active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none';
              const cls = [c.numeric ? 'rdl-num' : '', sortable ? 'rdl-th--sortable' : '']
                .filter(Boolean)
                .join(' ');
              return (
                <th key={c.key} className={cls || undefined} aria-sort={sortable ? aria : undefined}>
                  {sortable ? (
                    <button type="button" className="rdl-th__btn" onClick={() => toggle(c.key)}>
                      {c.header}
                      <span className="rdl-th__dir" aria-hidden="true">
                        {active ? (sort.dir === 1 ? '▲' : '▼') : ''}
                      </span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {order.map((i) => {
            const row = rows[i] ?? {};
            return (
              <tr
                key={i}
                className={onRowSelect ? 'rdl-row--link' : undefined}
                tabIndex={onRowSelect ? 0 : undefined}
                role={onRowSelect ? 'button' : undefined}
                onClick={onRowSelect ? () => onRowSelect(i) : undefined}
                onKeyDown={
                  onRowSelect
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowSelect(i);
                        }
                      }
                    : undefined
                }
              >
                {columns.map((c) => (
                  <td key={c.key} className={c.numeric ? 'rdl-num' : undefined}>
                    {row[c.key]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
