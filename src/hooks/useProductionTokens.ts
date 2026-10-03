import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { 
  productionTokenEventRpcArraySchema, 
  productionTokenStatsEventArraySchema 
} from "@/lib/schemas/productionTokenSchemas";

/**
 * Represents an event related to production tokens (minting, burning, locking, unlocking).
 */
export interface ProductionTokenEvent {
  id: string;
  protocol_step_id: string | null;
  batch_id: string | null;
  event_type: 'mint' | 'burn' | 'lock' | 'unlock';
  token_type: string;
  amount: number;
  reason: string;
  description: string | null;
  reference_volume: number | null;
  loss_volume: number | null;
  created_by: string | null;
  created_at: string;
  batch?: {
    batch_code: string;
    product_name: string;
  };
}

/**
 * Aggregated statistics for production tokens.
 */
export interface ProductionTokenStats {
  totalMinted: number;
  totalBurned: number;
  netTokens: number;
  mintEvents: number;
  burnEvents: number;
  totalVolume: number;
  totalLoss: number;
  efficiencyRate: number;
}

/**
 * Hook to fetch recent production token events.
 *
 * @param limit - The maximum number of events to fetch. Defaults to 50.
 * @returns Query result containing the list of production token events.
 */
export function useProductionTokenEvents(limit = 50) {
  return useQuery({
    queryKey: ["production-token-events", limit],
    queryFn: async (): Promise<ProductionTokenEvent[]> => {
      // RPC-only: use get_production_token_events function
      const { data, error } = await aisha.rpc("get_production_token_events", {
        p_limit: limit,
      });
      
      if (error) throw new Error(error.message);
      
      // Validate with Zod
      const parsed = productionTokenEventRpcArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("useProductionTokenEvents.validation", parsed.error);
        return [];
      }
      
      // Transform validated data into expected structure
      return parsed.data.map(row => ({
        id: row.id,
        protocol_step_id: row.protocol_step_id,
        batch_id: row.batch_id,
        event_type: row.event_type,
        token_type: row.token_type,
        amount: row.amount,
        reason: row.reason,
        description: row.description,
        reference_volume: row.reference_volume,
        loss_volume: row.loss_volume,
        created_by: row.created_by,
        created_at: row.created_at,
        batch: row.batch_code ? {
          batch_code: row.batch_code,
          product_name: row.product_name || '',
        } : undefined,
      }));
    },
  });
}

/**
 * Hook to fetch aggregated statistics for production tokens.
 *
 * @returns Query result containing production token statistics.
 */
export function useProductionTokenStats() {
  return useQuery({
    queryKey: ["production-token-stats"],
    queryFn: async (): Promise<ProductionTokenStats> => {
      // RPC-only: use get_production_token_stats function
      const { data, error } = await aisha.rpc("get_production_token_stats");
      
      if (error) throw new Error(error.message);
      
      // Validate with Zod
      const parsed = productionTokenStatsEventArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("useProductionTokenStats.validation", parsed.error);
        return {
          totalMinted: 0,
          totalBurned: 0,
          netTokens: 0,
          mintEvents: 0,
          burnEvents: 0,
          totalVolume: 0,
          totalLoss: 0,
          efficiencyRate: 100,
        };
      }
      
      const events = parsed.data;
      const mintEvents = events.filter(e => e.event_type === 'mint');
      const burnEvents = events.filter(e => e.event_type === 'burn');
      
      const totalMinted = mintEvents.reduce((sum, e) => sum + Number(e.amount || 0), 0);
      const totalBurned = burnEvents.reduce((sum, e) => sum + Number(e.amount || 0), 0);
      const totalVolume = mintEvents.reduce((sum, e) => sum + Number(e.reference_volume || 0), 0);
      const totalLoss = burnEvents.reduce((sum, e) => sum + Number(e.loss_volume || 0), 0);
      
      return {
        totalMinted,
        totalBurned,
        netTokens: totalMinted - totalBurned,
        mintEvents: mintEvents.length,
        burnEvents: burnEvents.length,
        totalVolume,
        totalLoss,
        efficiencyRate: totalVolume > 0 ? (1 - (totalLoss / totalVolume)) * 100 : 100,
      };
    },
  });
}

// Automatic triggers reference (for UI display)
export const AUTOMATIC_TRIGGERS = [
  { action: 'daily_checkin', trigger: 'health_check_ins INSERT', description: 'Auto-awards on check-in' },
  { action: 'dosing_log', trigger: 'dosing_logs INSERT', description: 'Auto-awards on dosing entry' },
  { action: 'lab_result', trigger: 'lab_results INSERT', description: 'Auto-awards on lab submission' },
  { action: 'first_lab_result', trigger: 'lab_results INSERT (first)', description: 'Bonus for first lab result' },
  { action: 'study_registration', trigger: 'study_registrations UPDATE→enrolled', description: 'Auto-awards on registration approval' },
  { action: 'study_completion', trigger: 'study_registrations UPDATE→completed', description: 'Auto-awards on study completion' },
  { action: 'data_sharing', trigger: 'data_sharing_consents INSERT', description: 'Auto-awards on consent grant' },
  { action: 'health_document', trigger: 'member_health_documents UPDATE→contributed', description: 'Auto-awards on document contribution' },
];

/**
 * Production token flow configuration.
 * Rates are loaded from token_reward_rules DB table via batch release trigger.
 * The constants below serve only as UI display defaults.
 */
export const PRODUCTION_TOKEN_FLOW = {
  minting: {
    trigger: 'Batch release (automatic trigger)',
    rate: 'Configured in token_reward_rules (production_batch_released)',
    description: 'Real value creation from manufacturing output — tokens minted automatically on batch release',
  },
  burning: {
    trigger: 'Production losses (automatic trigger)',
    rate: 'Configured in token_reward_rules (production_loss_penalty)',
    description: 'Value destruction from manufacturing inefficiency — penalty applied on batch release',
  },
};
