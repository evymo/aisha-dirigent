/**
 * DETAIL DOKLADU — co je na papíře, včetně položek.
 *
 * ⭐ UKAZATEL, NE KOPIE. Krok veze `doc_slug` (subjekt běhu, pravidlo
 * `expedice-dodaciho-listu`), a teprve tímhle dotazem se povrch dostane na
 * `line_items` registru. Kopírovat materiál a množství do `input_data` by
 * znamenalo druhou pravdu, která zestárne: doklad se může znovu naingestovat,
 * řádky se dořeší v review a registr zná `superseded_by` — kopie ne.
 *
 * ⛔ BEZ `doc_slug` SE NEPTÁ. `enabled` je false, dokud ukazatel nedorazí;
 * dotaz „na nic" by vracel prázdno, které vypadá stejně jako doklad bez
 * položek — a to jsou dvě různé věci.
 *
 * ⚠️ Na krocích vzniklých před 2026-09-01 `doc_slug` NENÍ (subjekt se skládá
 * při vzniku běhu). Doplňuje ho přeběh ingestu; do té doby se karta položek
 * prostě nekreslí.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/config/api";
import { asError } from "@/lib/asError";
import type { RadekDokladu } from "@/lib/polozkyDokladu";

export interface DetailDokladu {
  doc_slug: string | null;
  line_items: RadekDokladu[];
  /** Řádky, které čekají na člověka — povrch to má přiznat, ne schovat. */
  lines_pending: number;
}

export function useDocumentDetail(docSlug?: string | null) {
  return useQuery<DetailDokladu | null>({
    queryKey: ["document-detail", docSlug ?? ""],
    enabled: Boolean(docSlug),
    // Doklad se během jedné dodávky nemění; opakovaný dotaz u rampy je jen
    // zdržení a v terénu i baterie.
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await api.rpc("get_document_detail", {
        p_params: { doc_slug: docSlug } as never,
      });
      if (error) throw asError("document.detail", error);
      const d = (data as { data?: Record<string, unknown> } | null)?.data ?? null;
      if (!d) return null;
      return {
        doc_slug: typeof d.doc_slug === "string" ? d.doc_slug : null,
        line_items: Array.isArray(d.line_items) ? (d.line_items as RadekDokladu[]) : [],
        lines_pending: typeof d.lines_pending === "number" ? d.lines_pending : 0,
      };
    },
  });
}
