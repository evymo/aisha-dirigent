import type { ApiClient } from "@/integrations/api/client";

export interface PhiProfilePrefill {
  primary_diagnosis: string | null;
  current_medications: string | null;
  allergies: string | null;
  medical_history: string | null;
}

/**
 * Načte sensitive data data profilu pro předvyplnění formulářů.
 * 
 * Tato funkce používá auditované RPC volání pro bezpečné načtení citlivých
 * zdravotních údajů (diagnóza, léky, alergie, historie).
 * 
 * @param params - Parametry funkce
 * @param params.client - API klient (musí být PHI klient v sensitive data režimu)
 * @returns Objekt s citlivými daty nebo null pokud nenalezeno
 * 
 * @example
 * ```typescript
 * const phiData = await fetchPhiProfilePrefill({ client: secureClient });
 * ```
 */
export async function fetchPhiProfilePrefill(params: {
  client: ApiClient;
}): Promise<PhiProfilePrefill | null> {
  const { client } = params;

  const { data, error } = await client.rpc("get_my_phi_profile_prefill_audited");

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  return {
    primary_diagnosis: row.primary_diagnosis ?? null,
    current_medications: row.current_medications ?? null,
    allergies: row.allergies ?? null,
    medical_history: row.medical_history ?? null,
  };
}
