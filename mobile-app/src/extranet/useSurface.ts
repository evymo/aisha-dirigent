/**
 * Extranet surface data — the mobile COEXIST read path (tenant integration plan):
 * native screens over the same surface RPCs the web shells consume, via the
 * gateway (`/rest/v1/rpc`, KC bearer → HS256 mint verified end-to-end).
 *
 * Contracts (verified against the SQL drafts, 2026-07-19):
 *   get_surface_layout(p_surface) → { schema_version, surface,
 *     blocks: [{ block_slug, block_type, title_key, position }] }
 *     — empty layout (not an error) when RLS grants nothing.
 *   get_block_data(p_block_slug, p_params) → data-RPC result ∪ envelope:
 *     { data, provenance: { source_slug, freshness_at, trace_id },
 *       schema_version, block_slug, block_type, title_key, sensitivity }
 *
 * Every figure carries provenance — "žádné číslo bez zdroje" is a hard design
 * law of the extranet, mobile included.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/config/api";
import { safeError } from "@/lib/security/safeLogger";

import type { Json } from "@/types/database";

/**
 * The surface RPCs are in the SoT (`aisha/db/sql/functions/`) and `db:types:gen`
 * carries them, so `api.rpc` accepts these names directly — the local typed
 * bridge that used to stand here is gone with the overlay it worked around.
 */
const surfaceRpc = api.rpc;

export interface SurfaceLayoutBlock {
  block_slug: string;
  block_type: string;
  title_key: string;
  position: number;
  /**
   * How the block WANTS to be arranged — a hint, not a renderer name. The layout
   * contract carries it (`surface-blocks/schemas.ts`) and the web shell reads it;
   * this client used to drop it on the floor, so a row marked `tape` arrived as a
   * plain queue on the phone while the desktop showed the day's stream. Unknown
   * values must fall back to the block's default rendering, never drop the row.
   */
  presentation?: string;
}

/**
 * One navigable section of the extranet, exactly as the backend serves it.
 * `state: 'inactive'` means declared but not yet wired to a source — shown
 * greyed with its reason, never hidden, so a gap is visible instead of absent.
 */
export interface SurfaceSection {
  section: string;
  block_count: number;
  title_key?: string;
  group_key?: string;
  group_order?: number;
  position?: number;
  state?: "active" | "inactive";
  reason_key?: string;
}

export interface BlockProvenance {
  source_slug?: string;
  freshness_at?: string;
  trace_id?: string;
}

/** Na CO blok ukazuje. `entity_kind` je otevřený slug — viz surface-blocks. */
export interface BlockTarget {
  entity_kind: string;
  entity_id: string;
  label?: string;
}

export interface SurfaceBlockData {
  block_slug: string;
  block_type: string;
  title_key?: string;
  sensitivity?: string;
  data?: unknown;
  provenance?: BlockProvenance;
  /**
   * „A je to tenhle záznam." Server ho posílá VÝHRADNĚ tomu, kdo o něj požádal
   * (`want_target`), protože jedno neznámé pole zneplatní ve webovém shellu
   * celý blok — tenhle klient o něj žádá, protože mu rozumí.
   */
  target?: BlockTarget;
}

function rpcError(scope: string, error: unknown): Error {
  safeError(scope, error);
  return error instanceof Error
    ? error
    : new Error(String((error as { message?: string } | null)?.message ?? error));
}

/** Layout of a named surface; [] when the caller has no grants (by design). */
export function useSurfaceLayout(surface: string, enabled = true) {
  return useQuery<SurfaceLayoutBlock[]>({
    queryKey: ["surface-layout", surface],
    enabled,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await surfaceRpc("get_surface_layout", { p_surface: surface });
      if (error) throw rpcError("extranet.layout", error);
      const blocks = (data as { blocks?: unknown } | null)?.blocks;
      if (!Array.isArray(blocks)) return [];
      return blocks.filter(
        (b): b is SurfaceLayoutBlock =>
          !!b && typeof b === "object" && typeof (b as SurfaceLayoutBlock).block_slug === "string",
      );
    },
  });
}

/**
 * Which sections exist is DATA — the client discovers them instead of shipping a
 * list. The web shell learned this when it hardcoded 'workbench' and left the
 * 'porada' section without any client; this screen hardcoded 'porada' and left
 * every other section (měřidla, vozový park, stroje…) unreachable on the phone.
 * A new section now appears here without an app release — which is the whole
 * point of sections being rows rather than code.
 *
 * [] when the caller was granted nothing: an empty extranet is a legitimate
 * state (RLS default-deny), not an error.
 */
export function useSurfaceSections(enabled = true) {
  return useQuery<SurfaceSection[]>({
    queryKey: ["surface-sections"],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // No arguments by contract: the RPC answers for the CALLER's grants, so
      // there is nothing for the client to narrow — passing `{}` is a type error.
      const { data, error } = await surfaceRpc("list_surface_sections");
      if (error) throw rpcError("extranet.sections", error);
      if (!Array.isArray(data)) return [];
      return (data as unknown[]).filter(
        (s): s is SurfaceSection =>
          !!s && typeof s === "object" && typeof (s as SurfaceSection).section === "string",
      );
    },
  });
}

/** One block's data through the allowlisted dispatcher. */
export function useBlockData(blockSlug: string, params?: Record<string, unknown>) {
  return useQuery<SurfaceBlockData>({
    queryKey: ["surface-block", blockSlug, params ?? {}],
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await surfaceRpc("get_block_data", {
        p_block_slug: blockSlug,
        ...(params ? { p_params: params as Json } : {}),
      });
      if (error) throw rpcError("extranet.block", error);
      // Through `unknown`: the generated type is `Json`, and the block envelope
      // shape is guaranteed by the contract, not by the RPC signature.
      return (data ?? { block_slug: blockSlug, block_type: "unknown" }) as unknown as SurfaceBlockData;
    },
  });
}
