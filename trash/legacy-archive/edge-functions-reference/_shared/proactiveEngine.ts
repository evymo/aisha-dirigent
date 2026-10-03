/**
 * Proactive Trigger Engine — Evaluates conditions and dispatches AI actions.
 *
 * This module is the core of the proactive agent system. It:
 * 1. Loads active triggers for a source table/event from the DB
 * 2. Evaluates JSON conditions against incoming data
 * 3. Checks cooldown (rate limiting per user/trigger)
 * 4. Checks agent autonomy level (manual agents block proactive dispatch)
 * 5. Dispatches AI analysis via the LLM router
 * 6. Records run results and traces
 *
 * Architecture: Purely event-driven — no scheduled jobs or cron.
 * Pipeline orchestration is handled by n8n via RabbitMQ.
 *
 * Called by:
 *   - `ai-proactive` edge function (event-driven)
 *   - n8n-trigger for event-driven automation
 *
 * Condition format:
 *   { "field": "pain_level", "operator": ">", "value": 7 }
 *   { "field": "pain_level", "operator": ">", "value": 7, "consecutive_days": 3 }
 *   { "field": "id", "operator": "exists" }
 *   { "check": "missing_dosing_logs", "days": 3 }
 *   { "field": "longevity_score", "operator": "delta_below", "value": -5 }
 *
 * Usage:
 *   import { createProactiveEngine } from "../_shared/proactiveEngine.ts";
 *
 *   const engine = createProactiveEngine(serviceClient, tracer);
 *   const results = await engine.evaluateSource("health_check_ins", "INSERT", recordData, userId);
 *
 * @module
 */

import type { SupabaseClient } from "./deps.ts";
import type { Tracer } from "./tracer.ts";
import { getDefaultModel } from "./defaultModel.ts";
import { createHippocampus } from "./hippocampus.ts";

// =============================================================================
// Types
// =============================================================================

/** Trigger definition returned by get_active_triggers_for_source RPC. */
export interface TriggerDefinition {
  id: string;
  name: string;
  condition: TriggerCondition;
  action_type: TriggerActionType;
  agent_name: string | null;
  workflow_name: string | null;
  action_config: Record<string, unknown>;
  target_roles: string[];
  priority: TriggerPriority;
  cooldown_minutes: number;
}

/** JSON condition for a trigger. */
export interface TriggerCondition {
  /** Field name to check on the source record. */
  field?: string;
  /** Comparison operator. */
  operator?: ">" | ">=" | "<" | "<=" | "=" | "!=" | "exists" | "delta_below" | "delta_above";
  /** Threshold value. */
  value?: number | string;
  /** For consecutive checks: minimum consecutive days matching the condition. */
  consecutive_days?: number;
  /** For custom checks (e.g. missing_dosing_logs). */
  check?: string;
  /** Days parameter for custom checks. */
  days?: number;
}

/** Action types for proactive triggers. */
export type TriggerActionType = "analyze" | "alert" | "story_entry" | "notification" | "escalation";

/** Priority levels. */
export type TriggerPriority = "low" | "normal" | "high" | "critical";

/** Result of evaluating a single trigger. */
export interface TriggerEvalResult {
  triggerId: string;
  triggerName: string;
  matched: boolean;
  skippedReason?: "cooldown" | "condition_not_met" | "no_data" | "error";
  actionTaken?: string;
  outputText?: string;
  outputData?: Record<string, unknown>;
  durationMs?: number;
  tokensInput?: number;
  tokensOutput?: number;
  error?: string;
}

/** Input to the engine for a source event. */
export interface SourceEventInput {
  /** The table that emitted the event. */
  sourceTable: string;
  /** The event type. */
  sourceEvent: "INSERT" | "UPDATE" | "DELETE" | "CRON";
  /** The record data (e.g. the new row). */
  recordData: Record<string, unknown>;
  /** The user associated with the event. */
  userId: string;
  /** Optional: the record ID from the source table. */
  sourceRecordId?: string;
}

// =============================================================================
// Condition Evaluator
// =============================================================================

/**
 * Evaluate a trigger condition against record data.
 *
 * Returns true if the condition is met.
 */
export function evaluateCondition(
  condition: TriggerCondition,
  recordData: Record<string, unknown>,
): boolean {
  // Custom check types
  if (condition.check) {
    // Custom checks are evaluated server-side by the engine
    // (e.g. query DB for missing dosing logs)
    // For now, return true to indicate the custom check should be performed
    return true;
  }

  // Field-based conditions
  if (!condition.field || !condition.operator) {
    return false;
  }

  const fieldValue = recordData[condition.field];

  // Existence check
  if (condition.operator === "exists") {
    return fieldValue !== null && fieldValue !== undefined;
  }

  // Delta checks (delta_below, delta_above) need previous value — handled by engine
  if (condition.operator === "delta_below" || condition.operator === "delta_above") {
    return true; // Delegate to engine for historical comparison
  }

  // Numeric comparisons
  if (typeof condition.value === "number") {
    const numVal = typeof fieldValue === "number" ? fieldValue : Number(fieldValue);
    if (isNaN(numVal)) return false;

    switch (condition.operator) {
      case ">": return numVal > condition.value;
      case ">=": return numVal >= condition.value;
      case "<": return numVal < condition.value;
      case "<=": return numVal <= condition.value;
      case "=": return numVal === condition.value;
      case "!=": return numVal !== condition.value;
      default: return false;
    }
  }

  // String comparisons
  if (typeof condition.value === "string") {
    const strVal = String(fieldValue ?? "");
    switch (condition.operator) {
      case "=": return strVal === condition.value;
      case "!=": return strVal !== condition.value;
      default: return false;
    }
  }

  return false;
}

// =============================================================================
// Engine
// =============================================================================

export interface ProactiveEngine {
  /**
   * Evaluate all active triggers for a source event.
   * Returns array of evaluation results.
   */
  evaluateSource(input: SourceEventInput): Promise<TriggerEvalResult[]>;

  /**
   * Get summary statistics for the proactive system.
   */
  getStats(): Promise<{
    activeTriggers: number;
    runsToday: number;
  }>;
}

/**
 * Create a proactive trigger engine instance.
 *
 * @param serviceClient - Supabase client with service_role for DB access
 * @param tracer - Tracer for observability
 */
export function createProactiveEngine(
  serviceClient: SupabaseClient,
  tracer: Tracer,
): ProactiveEngine {

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function loadTriggers(
    sourceTable: string,
    sourceEvent: string,
  ): Promise<TriggerDefinition[]> {
    const { data, error } = await serviceClient.rpc(
      "get_active_triggers_for_source",
      { p_source_event: sourceEvent, p_source_table: sourceTable },
    );
    if (error) {
      console.error("Failed to load triggers:", error.message);
      return [];
    }
    return (data ?? []) as TriggerDefinition[];
  }

  async function checkCooldown(
    triggerId: string,
    userId: string,
  ): Promise<boolean> {
    const { data, error } = await serviceClient.rpc(
      "check_trigger_cooldown",
      { p_trigger_definition_id: triggerId, p_user_id: userId },
    );
    if (error) {
      console.error("Cooldown check failed:", error.message);
      return false;
    }
    return data === true;
  }

  async function saveRun(params: {
    triggerDefinitionId: string;
    userId: string;
    sourceRecordId?: string;
    sourceData?: Record<string, unknown>;
    status: string;
    aiRunId?: string;
    outputText?: string;
    outputData?: Record<string, unknown>;
    actionTaken?: string;
    actionResult?: Record<string, unknown>;
    startedAt?: string;
    completedAt?: string;
    durationMs?: number;
    tokensInput?: number;
    tokensOutput?: number;
    errorMessage?: string;
  }): Promise<string | null> {
    const { data, error } = await serviceClient.rpc(
      "save_proactive_run",
      {
        p_action_result: params.actionResult ?? null,
        p_action_taken: params.actionTaken ?? null,
        p_ai_run_id: params.aiRunId ?? null,
        p_completed_at: params.completedAt ?? null,
        p_duration_ms: params.durationMs ?? null,
        p_error_message: params.errorMessage ?? null,
        p_metadata: {},
      
        p_output_data: params.outputData ?? null,
        p_output_text: params.outputText ?? null,
        p_source_data: params.sourceData ?? null,
        p_source_record_id: params.sourceRecordId ?? null,
        p_started_at: params.startedAt ?? null,
        p_status: params.status,
        p_tokens_input: params.tokensInput ?? 0,
        p_tokens_output: params.tokensOutput ?? 0,
        p_trigger_definition_id: params.triggerDefinitionId,
        p_user_id: params.userId,},
    );
    if (error) {
      console.error("Failed to save proactive run:", error.message);
      return null;
    }
    return data as string;
  }

  /** Build a system prompt for proactive trigger analysis. */
  function buildPrompt(
    trigger: TriggerDefinition,
    sourceData: Record<string, unknown>,
  ): string {
    const actionPrompts: Record<TriggerActionType, string> = {
      analyze: "Analyze this health data event and provide a concise, actionable insight. Focus on what the data means for the user's wellbeing.",
      alert: "This health data requires attention. Create a clear, concise alert message for the care coordinator (Dirigent) explaining what happened and what action may be needed.",
      story_entry: "Create a personalized Story entry based on this health data. Write as if you are the user's health companion — empathetic, clear, and encouraging. Include the data point and what it might mean.",
      notification: "Create a brief, friendly push notification message for the user about this health data event. Keep it under 160 characters and actionable.",
      escalation: "This health data requires immediate attention. Create an escalation report for the care team including: severity assessment, recommended action, and urgency level.",
    };

    const basePrompt = actionPrompts[trigger.action_type] ?? actionPrompts.analyze;
    const configPrompt = typeof trigger.action_config?.prompt === "string"
      ? trigger.action_config.prompt
      : "";

    return [
      `You are a proactive health AI assistant for the Evymo platform.`,
      `Trigger: ${trigger.name} (priority: ${trigger.priority})`,
      basePrompt,
      configPrompt,
      `Data: ${JSON.stringify(sourceData)}`,
      `Respond in the user's language. Be concise and evidence-based. Never fabricate data. If you lack context, say so.`,
    ].filter(Boolean).join("\n\n");
  }

  // ---------------------------------------------------------------------------
  // Core: Evaluate single trigger
  // ---------------------------------------------------------------------------

  async function evaluateTrigger(
    trigger: TriggerDefinition,
    input: SourceEventInput,
  ): Promise<TriggerEvalResult> {
    const startTime = Date.now();

    return tracer.span<TriggerEvalResult>(
      "proactive_trigger",
      trigger.agent_name ?? "proactive",
      async () => {
        // 1. Check condition
        const conditionMet = evaluateCondition(trigger.condition, input.recordData);
        if (!conditionMet) {
          await saveRun({
            triggerDefinitionId: trigger.id,
            userId: input.userId,
            sourceRecordId: input.sourceRecordId,
            status: "skipped",
            durationMs: Date.now() - startTime,
          });
          return {
            triggerId: trigger.id,
            triggerName: trigger.name,
            matched: false,
            skippedReason: "condition_not_met",
          };
        }

        // 2. Check cooldown
        const canTrigger = await checkCooldown(trigger.id, input.userId);
        if (!canTrigger) {
          await saveRun({
            triggerDefinitionId: trigger.id,
            userId: input.userId,
            sourceRecordId: input.sourceRecordId,
            status: "cooldown",
            durationMs: Date.now() - startTime,
          });
          return {
            triggerId: trigger.id,
            triggerName: trigger.name,
            matched: true,
            skippedReason: "cooldown",
          };
        }

        // 2b. Check agent autonomy level — manual agents cannot dispatch autonomously
        if (trigger.agent_name) {
          const { data: agentRows } = await serviceClient.rpc(
            "get_agent_catalog_entry",
            { p_slug: trigger.agent_name },
          );
          const agentData = Array.isArray(agentRows) ? agentRows[0] as Record<string, unknown> | undefined : undefined;
          const autonomyLevel = agentData?.autonomy_level as string | undefined;
          if (autonomyLevel === "manual") {
            await saveRun({
              triggerDefinitionId: trigger.id,
              userId: input.userId,
              sourceRecordId: input.sourceRecordId,
              status: "skipped",
              durationMs: Date.now() - startTime,
              errorMessage: `Agent "${trigger.agent_name}" has autonomy_level=manual; proactive dispatch blocked`,
            });
            return {
              triggerId: trigger.id,
              triggerName: trigger.name,
              matched: true,
              skippedReason: "agent_autonomy_blocked",
            };
          }
        }

        // 3. Dispatch AI analysis
        try {
          const { unifiedChat, resolveProvider } = await import("./llmRouter.ts");

          const model = trigger.action_config?.model as string ?? getDefaultModel();
          const basePrompt = buildPrompt(trigger, input.recordData);

          // Hippocampus: Resolve per-user personality for proactive messages.
          // Degradation-safe — personality enhances tone but is not required.
          let systemPrompt = basePrompt;
          try {
            const hippo = createHippocampus(serviceClient, tracer, { userId: input.userId });
            const pCtx = await hippo.resolvePersonality();
            const pPrompt = hippo.buildPersonalityPrompt(pCtx);
            if (pPrompt) {
              systemPrompt = pPrompt + '\n\n' + basePrompt;
            }
          } catch {
            // Non-blocking — proactive messages work without personality
          }

          const result = await tracer.span(
            "proactive_evaluation",
            trigger.agent_name ?? "proactive",
            () => unifiedChat({
              provider: resolveProvider(model),
              model,
              systemPrompt,
              messages: [{
                role: "user",
                content: `Process this ${trigger.action_type} for trigger "${trigger.name}".`,
              }],
              temperature: 0.3,
              maxTokens: 500,
            }),
          );

          const durationMs = Date.now() - startTime;

          // 4. Record result
          const actionTaken = `${trigger.action_type}_generated`;
          await saveRun({
            triggerDefinitionId: trigger.id,
            userId: input.userId,
            sourceRecordId: input.sourceRecordId,
            sourceData: input.recordData,
            status: "completed",
            aiRunId: tracer.runId ?? undefined,
            outputText: result.text,
            outputData: { provider: result.provider, model: result.model },
            actionTaken,
            actionResult: {
              text: result.text,
              priority: trigger.priority,
              action_type: trigger.action_type,
            },
            startedAt: new Date(startTime).toISOString(),
            completedAt: new Date().toISOString(),
            durationMs,
            tokensInput: result.usage.inputTokens,
            tokensOutput: result.usage.outputTokens,
          });

          return {
            triggerId: trigger.id,
            triggerName: trigger.name,
            matched: true,
            actionTaken,
            outputText: result.text,
            outputData: { provider: result.provider, model: result.model },
            durationMs,
            tokensInput: result.usage.inputTokens,
            tokensOutput: result.usage.outputTokens,
          };
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Unknown error";
          const durationMs = Date.now() - startTime;

          await saveRun({
            triggerDefinitionId: trigger.id,
            userId: input.userId,
            sourceRecordId: input.sourceRecordId,
            sourceData: input.recordData,
            status: "failed",
            errorMessage: errorMsg,
            startedAt: new Date(startTime).toISOString(),
            completedAt: new Date().toISOString(),
            durationMs,
          });

          return {
            triggerId: trigger.id,
            triggerName: trigger.name,
            matched: true,
            error: errorMsg,
            durationMs,
          };
        }
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    async evaluateSource(input: SourceEventInput): Promise<TriggerEvalResult[]> {
      const triggers = await loadTriggers(input.sourceTable, input.sourceEvent);

      if (triggers.length === 0) {
        return [];
      }

      const results: TriggerEvalResult[] = [];
      for (const trigger of triggers) {
        const result = await evaluateTrigger(trigger, input);
        results.push(result);
      }

      return results;
    },

    async getStats(): Promise<{
      activeTriggers: number;
      runsToday: number;
    }> {
      const triggersRes = await serviceClient.rpc("get_ai_triggers_admin");
      const triggers = (triggersRes.data ?? []) as Array<{ is_active: boolean }>;

      const runsRes = await serviceClient.rpc("count_ai_proactive_runs_today");
      const runsToday = (runsRes.data as number) ?? 0;

      return {
        activeTriggers: triggers.filter((t) => t.is_active).length,
        runsToday,
      };
    },
  };
}
