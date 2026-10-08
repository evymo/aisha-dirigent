/**
 * Pověření poskytovatelů AI (tokeny, API klíče) — administrace instance.
 *
 * Každý fork = vlastní instance = vlastní trezor: správa si tu nastaví SVÉ tokeny.
 * Katalog (které pověření existují a kdo je používá) je odvozený z dat v DB —
 * žádný seznam jmen ve frontendu. Hodnota se jen ZAPISUJE; zpět se nikdy nečte
 * (RPC vrací jen přítomnost, čas a autora změny).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";

export interface ProviderCredentialUser {
  /** 'provider' | 'runtime' | 'mcp_server' — odkud deklarace pochází. */
  kind: string;
  slug: string;
  displayName: string;
}

export interface ProviderCredential {
  /** Jméno proměnné (např. ANTHROPIC_API_KEY) — klíč pověření. */
  envVar: string;
  /** Kdo pověření deklaruje; prázdné = osiřelé (nikdo ho už nepoužívá). */
  usedBy: ProviderCredentialUser[];
  isSet: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  /** 'admin' | 'env' (přesunuto z prostředí služby) | jiné; null = nenastaveno. */
  source: string | null;
}

const QUERY_KEY = ["admin", "provider-credentials"] as const;

function parseUsers(raw: unknown): ProviderCredentialUser[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((u): u is Record<string, unknown> => Boolean(u) && typeof u === "object")
    .map((u) => ({
      kind: String(u.kind ?? ""),
      slug: String(u.slug ?? ""),
      displayName: String(u.display_name ?? u.slug ?? ""),
    }));
}

/** Katalog pověření se stavem (bez hodnot). */
export function useProviderCredentials() {
  return useQuery({
    queryKey: QUERY_KEY,
    staleTime: 30_000,
    queryFn: async (): Promise<ProviderCredential[]> => {
      const { data, error } = await aisha.rpc("get_provider_credential_catalog");
      if (error) {
        safeError("admin.providerCredentials.loadFailed", error as Error);
        throw new Error(error.message);
      }
      if (!Array.isArray(data)) return [];
      return data.map((r) => ({
        envVar: String(r.env_var),
        usedBy: parseUsers(r.used_by),
        isSet: r.is_set === true,
        updatedAt: r.updated_at ? String(r.updated_at) : null,
        updatedBy: r.updated_by ? String(r.updated_by) : null,
        source: r.source ? String(r.source) : null,
      }));
    },
  });
}

/** Nastavit / nahradit pověření. Hodnota odchází jen jako parametr RPC. */
export function useSetProviderCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ envVar, value }: { envVar: string; value: string }): Promise<void> => {
      const { error } = await aisha.rpc("set_provider_credential_admin", {
        p_env_var: envVar,
        p_value: value,
      });
      if (error) {
        safeError("admin.providerCredentials.saveFailed", error as Error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

/** Smazat pověření z trezoru instance. */
export function useDeleteProviderCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ envVar }: { envVar: string }): Promise<void> => {
      const { error } = await aisha.rpc("delete_provider_credential_admin", { p_env_var: envVar });
      if (error) {
        safeError("admin.providerCredentials.deleteFailed", error as Error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
