/**
 * Hook pro načtení sdílených útržků (hlavička, patička) publikovaného webu.
 *
 * ⛔ PROČ SAMOSTATNÝ DOTAZ. Útržek není vlastnost stránky — je to obsah
 * sdílený VŠEMI stránkami. Kdyby se vracel u každé stránky zvlášť, přenášela
 * by se tatáž hlavička při každé navigaci znovu; takhle sedí v cache jednou
 * a proklik uvnitř webu ji už nestahuje.
 *
 * ⛔ SPOUŠTÍ SE SOUBĚŽNĚ SE STRÁNKOU, ne po ní. Dotaz je proto vytažený
 * z hooku (týž vzor jako `webPageQuery`), aby ho prefetch v `main.tsx` mohl
 * odpálit zároveň — sériové načtení by přidalo celý jeden okruh k času,
 * než se objeví první pixel.
 *
 * @module
 */

import { useQuery } from "@tanstack/react-query";

import { aisha } from "@/integrations/db/client";
import { webPartialSchema } from "@/lib/schemas/webPageSchemas";
import { parseRpcArray } from "@/lib/validation/rpcSchemas";

import type { WebPartial } from "@/lib/schemas/webPageSchemas";

const STALE_TIME = 5 * 60 * 1000; // 5 minut — táž hodnota jako u stránek

/** Útržky jako mapa `ref → canvas_html`, tedy tvar, který chce `expandPartials`. */
export type PartialMap = Record<string, string>;

function naMapu(rows: WebPartial[]): PartialMap {
  const m: PartialMap = {};
  for (const r of rows) {
    // Útržek bez plátna je prázdný, ne chybějící: kdyby se přeskočil,
    // `expandPartials` by ho hlásil jako chybějící a značka by zůstala
    // v HTML — tedy hlášená vada tam, kde autor jen nic nenapsal.
    m[r.ref] = r.canvas_html ?? "";
  }
  return m;
}

export function webPartialsQuery() {
  return {
    queryFn: async (): Promise<PartialMap> => {
      const { data, error } = await aisha.rpc("get_published_web_partials", {
        p_hostname: window.location.hostname || undefined,
      });
      if (error) throw new Error(error.message);
      return naMapu(parseRpcArray(webPartialSchema, data, "get_published_web_partials"));
    },
    queryKey: ["web-partials"] as const,
    staleTime: STALE_TIME,
  };
}

export function useWebPartials() {
  return useQuery<PartialMap>(webPartialsQuery());
}
