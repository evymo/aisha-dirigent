/**
 * Co čeká na odeslání — a proč to řidič musí VIDĚT, ne se dozvědět.
 *
 * ⛔ NAMĚŘENO 2026-08-20: `useOffline` drží `queueSize`, `needsAttention`
 * i `storeUnreadable`, ale `kroky.tsx` si z něj bral JEDINÝ údaj (`isConnected`).
 * Řidič se o frontě dozvěděl výhradně z hlášky po odeslání — ta zmizí a s ní
 * i jediná stopa. Kdo v lomu potvrdil tři předání, neměl jak zjistit, jestli
 * odešla; jediná jistota byla zavolat dispečerovi.
 *
 * ⭐ PROČ ROZHODOVÁNÍ ŽIJE TADY. Je to tabulka o pěti vstupech a čtyřech
 * odpovědích a rozhoduje o tom, čemu člověk uvěří. Uvnitř JSX by se nedala ani
 * vyslovit, ani změřit — a přesně tam se rodí tvrzení „0 čeká", které je lež.
 *
 * ⛔ NULA JE TVRZENÍ, NE VÝCHOZÍ HODNOTA. Když trezor nejde přečíst, NEVÍME,
 * co ve frontě je. Odznak s nulou nad podepsaným předáním, které se jen nedá
 * přečíst, je horší než žádný odznak: člověk odejde z rampy v klidu.
 *
 * @module
 */

/**
 * Co se o frontě dá říct.
 *
 * `nevim`             — úložiště nejde přečíst. Počet NEZNÁME.
 * `vyzaduje-cloveka`  — položky vyčerpaly pokusy. Samy se neodešlou.
 * `odesila`           — právě teď odchází.
 * `ceka`              — leží a čeká na signál.
 */
export type PovahaFronty = "nevim" | "vyzaduje-cloveka" | "odesila" | "ceka";

export interface StavFronty {
  povaha: PovahaFronty;
  /** Kolik položek. `null` = nevíme (a nesmí se dosadit nula). */
  pocet: number | null;
}

/** Vstup — přesně to, co drží `useOffline`. */
export interface VstupFronty {
  queueSize: number;
  needsAttention: number;
  isProcessing: boolean;
  isConnected: boolean;
  storeUnreadable: boolean;
}

/**
 * Co o frontě říct. `null` znamená NEKRESLIT NIC.
 *
 * ⭐ Prázdná fronta mlčí (JAZYK-03). Trvalý pruh „vše odesláno" by se po dvou
 * dnech stal součástí pozadí a v den, kdy se změní na „3 čekají", by si ho
 * nikdo nevšiml. Odznak, který je vidět vždycky, není odznak.
 */
export function stavFronty(v: VstupFronty): StavFronty | null {
  // 1. Nevím přebíjí všechno. Žádné z dalších tvrzení nemám z čeho doložit —
  //    `needsAttention` i `queueSize` jsou v tomhle stavu poslední ZNÁMÉ
  //    hodnoty, ne měření. Tvrdit podle nich cokoli by bylo hádání.
  if (v.storeUnreadable) return { povaha: "nevim", pocet: null };

  // 2. Co čeká na člověka, se samo neodešle — a je to jediný stav, ve kterém
  //    má odznak žádat pozornost. Ukazuje se i vedle položek, které ještě
  //    zkoušet budou: horší zpráva je ta, která platí.
  if (v.needsAttention > 0) return { povaha: "vyzaduje-cloveka", pocet: v.needsAttention };

  if (v.queueSize === 0) return null;

  // 3. „Odesílá se" jen když se opravdu odesílá. Bez signálu se nic neodesílá,
  //    i kdyby příznak z minulého běhu zůstal viset.
  if (v.isProcessing && v.isConnected) return { povaha: "odesila", pocet: v.queueSize };

  return { povaha: "ceka", pocet: v.queueSize };
}
