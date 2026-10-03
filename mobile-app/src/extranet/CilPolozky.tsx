/**
 * Cíl položky pásky — co se na zastávce skládá („12,5 t · Kamenivo 8/16").
 *
 * ⭐ PODLE DRUHU ENTITY, STEJNĚ JAKO `ENTITY_ROUTES`. Renderer pásky neví, co je
 * dodací list; ví jen `entity_kind` položky. Druh, který tady nemá řádek, cíl
 * nemá a karta ho prostě nekreslí — obchůzka měřidel tak funguje beze změny.
 *
 * ⭐ UKAZATEL, NE KOPIE. Materiál a množství nejsou v položce pásky: jsou to
 * `line_items` dokladu a dostane se na ně jen přes `doc_slug` kroku (viz
 * `useDocumentDetail`). Ptá se JEN karta TEĎ — jeden krok, dva dotazy, a oba
 * sdílejí klíč s obrazovkou kroku, takže otevření detailu je pak okamžité.
 *
 * ⛔ Bez `doc_slug` se cíl nekreslí (tablet: projekce kiosku ukazatel nenese;
 * starší kroky ho nemají). Prázdné je poctivější než domyšlené.
 */
import type { ComponentType, ReactNode } from "react";
import { useWorkflowStep } from "@/hooks/useWorkflowSteps";
import { useDocumentDetail } from "@/hooks/useDocumentDetail";
import { cilZPolozek, polozkyKZobrazeni, type CilZastavky } from "@/lib/polozkyDokladu";

type Vykresli = (cil: CilZastavky) => ReactNode;

function CilKroku({ id, children }: { id: string; children: Vykresli }) {
  const krok = useWorkflowStep(id);
  const vstup = krok.data?.input_data as Record<string, unknown> | null | undefined;
  const slug = typeof vstup?.doc_slug === "string" && vstup.doc_slug ? vstup.doc_slug : null;
  const doklad = useDocumentDetail(slug);
  const cil = cilZPolozek(polozkyKZobrazeni(doklad.data?.line_items));
  return cil ? <>{children(cil)}</> : null;
}

const CIL_PODLE_DRUHU: Record<string, ComponentType<{ id: string; children: Vykresli }>> = {
  workflow_step: CilKroku,
};

export function CilPolozky({ kind, id, children }: { kind?: string; id?: unknown; children: Vykresli }) {
  const Cil = kind ? CIL_PODLE_DRUHU[kind] : undefined;
  if (!Cil || typeof id !== "string" || !id) return null;
  return <Cil id={id}>{children}</Cil>;
}
