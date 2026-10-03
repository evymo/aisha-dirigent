/**
 * Known Security Issues Configuration
 *
 * Tyto problémy jsou známé a budou řešeny v budoucích PR.
 * Každý problém musí mít:
 * - issue: číslo nebo popis ticketu
 * - reason: proč je v allowlistu
 * - deadline: kdy má být opraveno
 *
 * NIKDY nepřidávej problémy bez jasného plánu opravy!
 *
 * Kategorie pre KNOWN_NO_AUTH_FUNCTIONS:
 *   A) Trigger/internal — volány DB triggerem, ne uživatelem
 *   B) Auth-hook / Edge — volány Supabase auth hooks resp. Edge Functions se service role
 *   C) Helper/utility — volány z jiných SQL funkcí, nejsou user-facing
 *   D) Admin — používají is_admin_or_staff() / has_role(), analyzer nedetekuje
 *   E) Public/semi-public — veřejná data, nevyžadují auth.uid()
 *   F) Authenticated — analyzer nedetekuje alternativní auth pattern
 */

// sensitive data tabulky bez RLS - musí dostat RLS politiky
// Empty by design (all PHI tables carry RLS) — typed explicitly so helpers below
// keep compiling against the element shape when the list is empty.
export const KNOWN_PHI_TABLES_NO_RLS: ReadonlyArray<{ table: string }> = [];

// sensitive data funkce s GRANT pro anon - OPRAVENO migracemi
// 20260122_revoke_anon_secure_functions.sql opravil všechny sensitive data funkce
// Výjimka: get_study_consent_*_localized - potřebuje anon pro registration flow před signup
export const KNOWN_ANON_GRANT_FUNCTIONS = [
  // Public registration flow - consent requirements/items musí být viditelné před signup
  // Viz komentáře v aisha/db/sql/functions/get_study_consent_*.sql
  'get_study_consent_requirements_localized',
  'get_study_consent_items_localized',
] as const;

// ---------------------------------------------------------------------------
// SECURITY DEFINER funkce bez auth check (povolené výjimky)
// Všechny funkce existují v produkční DB — detekováno po přidání SQL source files
// ---------------------------------------------------------------------------
export const KNOWN_NO_AUTH_FUNCTIONS = [
  // === A) Trigger/internal — volány DB triggerem/interně, ne od uživatele ===
  'hub_sync_reprice_proposal_from_entry', // story_entries trigger: syncs reprice proposal status
  // Connector-doctrine delegators: pure wrappers whose auth is enforced in the
  // delegate (the static gate can't see through the call). Verified:
  'hub_verify_reprice_provenance', // -> hub_verify_provenance (gates is_service_role/is_admin_or_staff)
  'add_system_timeline_entry',
  'calculate_next_reminder_time',
  'check_admin_exists',
  'check_api_rate_limit',
  'cleanup_expired_sms_otp_codes',
  'cleanup_inactive_sessions',
  'cleanup_old_rate_limits',
  'cleanup_stale_mobile_sessions',
  'create_member_distribution_plan_on_registration',
  'create_notification',
  'ensure_leaderboard_periods',
  'generate_next_invoice_number',
  'generate_variable_symbol',
  'prevent_system_role_deletion',
  'set_questionnaire_response_version',
  'trigger_check_achievements',
  'trigger_timeline_dosing_log',
  'trigger_timeline_health_check_in',
  'trigger_timeline_health_log',
  'trigger_timeline_health_sync',
  'trigger_timeline_lab_result',
  'trigger_timeline_order',
  'trigger_timeline_questionnaire_response',
  'trigger_timeline_study_registration',
  'trigger_timeline_product_log',
  'trigger_timeline_wearable_analysis_file',
  'trigger_update_leaderboard',
  'trigger_update_streak_on_activity',
  'trigger_update_streak_on_health_checkin',
  'trigger_update_streak_on_reminder_completion',
  'update_conversation_message_count',
  'update_expedition_on_shipment_change',
  'update_leaderboard_rankings',
  'update_partner_stories_updated_at',
  'update_story_last_activity',
  'update_updated_at_column',
  'update_user_leaderboard_entry',
  'update_user_streak',
  'update_user_wallet_balance',
  'fn_notify_rule_change',
  'fn_recalculate_ruleset_fingerprint',
  'notify_expert_rules_changed',
  'sync_expert_rule_to_knowledge_item',
  'sync_topic_version_to_knowledge_item',
  'trg_production_batch_release_tokens',
  'trigger_knowledge_post_translation',
  'trg_update_training_dataset_counts',
  'fn_queue_blockchain_sync',         // Trigger on token_transactions → outbox INSERT
  'fn_get_agent_performance_snapshot', // Admin analytics — service_role only
  'get_model_pricing',                // Public pricing data — no sensitive info

  // === B) Auth-hook / Edge — volány Supabase hooks resp. Edge Functions (service role) ===
  // compose_context was here while it had no auth check. It now enforces a real
  // per-story RBAC guard (is_admin_or_staff(p_requester_id) OR owner/participant,
  // else 42501) for any non-NULL requester — the analyzer detects the
  // is_admin_or_staff()/auth.uid() pattern, so it no longer reports SEC_DEF_NO_AUTH.
  // Removed per the no-workarounds principle (same as resolve_deployed_url below):
  // never permanently whitelist a SECURITY DEFINER auth-bypass once a real check
  // exists. The NULL-requester system bypass is intentional (autonomous runs).
  // aisha_pre_request — PostgREST `db-pre-request` hook: volá ho PostgREST u KAŽDÉHO
  // požadavku, i anonymního; pro anon je no-op, přihlášeného JIT-zřídí přes
  // ensure_current_user. Detektor ho do 2026-09-18 neviděl: `auth.uid()` měl jen
  // v COMMENT ON (stripSqlComments v access.mjs to od té doby nepočítá).
  'aisha_pre_request',
  'handle_auth_send_email',
  'handle_new_user',
  'handle_order_payment_completed',
  'edge_app_secrets',
  'edge_blockchain_audit',
  'edge_database_dump_table',
  'edge_mobile_notifications',
  'edge_payment_sessions',
  'edge_public_partners_directory',
  'edge_sms_otp',
  'edge_stripe_disputes',
  'edge_subscriptions',
  'log_ai_trace_event',
  'log_n8n_trace_event',
  'route_task',
  'finish_ai_run',
  'fn_log_ai_trace_event',
  'get_active_agent_configs_for_edge',
  'insert_ai_trace_event',
  'complete_integration_event',
  'get_github_app_secrets_from_vault',
  'get_retryable_integration_events',
  'record_integration_event',
  'resolve_story_from_repo',
  // resolve_deployed_url was here as a workaround (commit fc4c0ae1) when
  // PR #73 introduced the SECURITY DEFINER bypass. Replaced with a real
  // auth check in migration 20260518131000_resolve_deployed_url_auth_check.sql
  // — the function now does is_admin_or_staff() OR service_role gate inline,
  // matching the RLS policy on coolify_app_slots. The allowlist entry is
  // no longer needed and removing it is per the no-workarounds principle
  // (feedback_no_workarounds_rewrite_dont_remove): fix the code, never
  // permanently whitelist a SECURITY DEFINER auth-bypass.
  'fn_log_dev_signal',
  'get_active_channel_config',
  'get_or_create_public_chat_session',
  'record_public_chat_message',
  // register_plugin_schedule: 2026-09-16 dostal nárok (is_service_role OR is_admin_or_staff) — výjimka pryč.
  'update_agent_run_status',  // service_role only (called by svc-agent-runner via service JWT)
  'get_user_id_by_email',     // service_role only (called by intranet gateway for token exchange)
  'is_intranet_channel_member', // RLS helper — auth-first COALESCE(auth.uid(), p_user_id); service_role fallback by design

  // === C) Helper/utility — volány z jiných SQL funkcí, ne přímo user-facing ===
  // 2026-09-19: is_story_participant, has_data_sharing_consent, can_receive_reward,
  // user_can_chat, user_has_admin_role a should_auto_approve_order dostaly stráž
  // volajícího (predikát o třetí osobě = orákulum) — výjimky pryč. Třídu hlídá
  // brána definer-subjekt-jen-volajici.
  'award_tokens',
  'calculate_member_compliance',
  'convert_currency_amount',
  'has_permission',
  'has_section_access',
  'process_token_reward',
  'record_audit_log',
  'role_is_admin',
  'sync_checkin_to_metrics',
  'validate_invitation',
  'validate_mcp_token',
  'validate_test_answers',
  'fn_evaluate_proposal_risk',

  // === D) Admin — používají is_admin_or_staff()/has_role(), analyzer nedetekuje ===
  'db_diagnose',
  'db_self_repair',
  'get_agent_catalog_admin',
  'get_agent_tool',
  'get_agent_tools_admin',
  'get_ai_agent_metrics',
  'get_ai_agent_metrics_timeseries',
  'get_ai_run_summary',
  'get_ai_runs_admin',
  'get_ai_trace_events_admin',
  'get_all_questionnaires_admin',
  'get_audit_journal',
  'get_audit_journal_stats_24h',
  'get_context_profiles_admin',
  'get_leaderboard_reward_configs_admin',
  'get_mcp_tokens_admin',
  'get_moderation_decisions_admin',
  'get_moderation_sessions_admin',
  'get_news_articles_admin',
  'get_pending_node_factory_requests',
  'get_questionnaires_admin',
  'get_session_monitoring_data',
  'get_suspicious_patterns',
  'get_test_questions_admin_localized',
  'get_tools_for_agent',
  'list_integration_services',
  'refresh_ai_agent_metrics',
  'register_custom_node',
  'revoke_app_role_permission_admin',
  'revoke_mcp_token_admin',
  'toggle_mcp_token_admin',
  'update_agent_catalog_admin',
  'update_context_profile_admin',
  'update_integration_health',
  'update_node_factory_request_status',
  'fn_get_trace_anomalies_24h',
  'get_active_stories_for_audit',
  'get_agent_decision_trees_admin',
  'get_model_registry_admin',
  'insert_eval_result',
  'insert_model_benchmark',
  'list_improvement_proposals_admin',
  'mark_models_unavailable',
  'upsert_discovered_model',
  'analyze_integration_performance',
  'get_exhausted_integration_events',
  'get_integration_event_stats',
  'get_integration_events_for_story',

  // === E) Public/semi-public — veřejná/nezabezpečená data, nevyžadují auth.uid() ===
  'get_approved_study_consultants',
  'get_biomarker_reference_ranges',
  'get_branding_profile',
  'get_combined_consent_requirements_localized',
  'get_community_products',
  'get_currency_rates',
  'get_partner_cities',
  'get_partner_profile',
  'get_products_for_checkout',
  'get_question_blocks_by_context_type',
  'get_question_blocks_for_context',
  'get_questionnaire_blocks_localized',
  'get_questionnaire_id_by_code',
  'get_registration_studies',
  'get_role_capabilities',
  'get_role_definitions',
  'get_rules_for_agent',
  'get_study_consent_requirements_localized',
  'get_study_consent_items_localized',
  'get_study_contributions',
  'get_study_informed_consent_special_provisions',
  'get_study_ratings',
  'get_test_questions_public',
  'get_translation_value_with_fallback',
  'get_translations_with_status',
  'get_umbrella_study',
  'mcp_get_story_context',
  'consult_decision_tree',
  'fn_create_improvement_proposal',
  'get_adaptive_model_tiers',
  'get_best_model_for_task',
  'mcp_consult_dirigent',
  'mcp_get_agent_memories',
  'mcp_get_claude_hook_bindings',
  'mcp_store_agent_memory',
  'mcp_summarize_agent_memories',

  // === F) Authenticated — alternativní auth pattern nedetekovaný analyzátorem ===
  'backfill_user_streaks',
  'check_user_achievements',
  'deactivate_web_push_subscriptions_by_endpoints',
  'get_active_web_push_subscriptions_for_users',
  'get_batch_detail_transparency',
  'get_due_reminders_for_notification',
  'get_partner_access_for_edge',
  'get_partner_available_slots',
  'get_pending_questionnaires_for_notifications',
  'submit_questionnaire_mobile',
  'process_due_story_reminders',
  'recalculate_all_ruleset_fingerprints',
  'get_story_aisha_maturity',

  // === G) Anon + bez kontroly — NOVĚ VIDITELNÉ (2026-09-12) ===
  // Do dneška je pravidlo SEC_DEF_NO_AUTH NEVIDĚLO: znělo
  // `hasClientGrant && !hasAnonGrant`, takže GRANT pro anon funkci z nálezu
  // VYŘADIL. Čím širší expozice, tím tišší brána. Po opravě pravidla je tady
  // 64 anonymně dostupných funkcí; tenhle seznam je RAČNA — smí jen klesat,
  // a každé NOVÉ jméno shodí běh.
  //
  // G1) Veřejný obsah webu — katalogy, překlady, novinky, studie, ceníky.
  // Nárok tu není proto, že žádný není: obsah je určen návštěvníkovi.
  'aisha_get_active_static_defense_rules',
  'commerce_base_currency',
  'commerce_base_locale',
  'edge_app_versions',
  'get_active_studies',
  'get_active_web_tracking',
  'get_archive_document_by_slug',
  'get_archive_documents',
  'get_archive_tags',
  'get_available_plugins',
  'get_biomarker_reference_ranges_localized',
  'get_certified_partners',
  'get_distribution_protocols_for_product',
  'get_dose_units',
  'get_enabled_auth_providers',
  'get_expertise_areas',
  'get_extended_studies',
  'get_featured_products',
  'get_news_article_by_slug',
  'get_news_tags',
  'get_partner_free_slots',
  'get_product_catalog',
  'get_product_dose_options',
  'get_product_reviews_with_stats',
  'get_product_transparency',
  'get_products_public',
  'get_public_hero_slides',
  'get_public_homepage_stats',
  'get_public_partner_booked_slots',
  'get_public_product_by_slug',
  'get_public_products',
  'get_public_service_status',
  'get_published_news_articles',
  'get_published_news_articles_filtered',
  // Zviditelněné 2026-09-18 (merge riq/main): publikovaný web instance —
  // `status = 'published'`, `is_active`, brand `published`. Nárok v těle JE
  // ta podmínka; nejde o novou expozici, jen o funkce, které detektor dřív minul.
  'get_published_web_page_index',
  'get_published_web_partials',
  'get_shipping_cost',
  'get_study_detail',
  'get_study_registration_questionnaire',
  'get_subscription_packages',
  'get_supported_languages',
  'get_symptom_catalog',
  'get_test_questions_public_localized',
  'get_token_reward_rules_localized',
  'get_translation_value',
  'get_translations',
  'get_translations_by_key',
  'get_translations_for_keys',
  'get_translations_for_namespace',
  'get_translations_map',
  'get_translations_map_with_fallback',
  'get_web_page_by_slug',
  'is_umbrella_study',

  // G2) ⚠️ ZAPSÁNO K REVIZI, NE POSVĚCENO. Tyhle anonymně dostupné funkce
  // vydávají víc než veřejný obsah a čekají na rozhodnutí majitele:
  //   · get_guild_member*  — vydávají `user_id` účtů (adresář partnerů). Ve
  //     dvojici s predikátem nároku to dřív dávalo výčet administrátorů;
  //     druhou půlku řetězu zavřela stráž v has_role (2026-09-12).
  //   · mcp_*              — vnitřní znalostní a pravidlový povrch.
  //   · register_plugin_event — ZÁPIS dostupný bez účtu.
  //   · generate_default_copilot_instructions — vnitřní instrukční text.
  // Plán opravy: rozhodnout, co z toho je záměrně veřejné; zbytek dostane
  // stráž a spadne z račny.
  'generate_default_copilot_instructions',
  'get_guild_member_detail',
  'get_guild_members',
  'get_guild_members_marketplace',
  'mcp_get_expertise_areas',
  'mcp_get_knowledge_stats',
  'mcp_get_rule_detail',
  'mcp_match_experts',
  'register_plugin_event',
] as const;

// ---------------------------------------------------------------------------
// Funkce bez consent check (vyžadují review)
// ---------------------------------------------------------------------------
export const KNOWN_NO_CONSENT_FUNCTIONS = [
  // Tyto funkce přistupují k user datům ale mají jiný typ autorizace
  // např. jsou volány pouze z admin kontextu
  'get_consultant_users',
  'get_partner_user_registrations',
  'get_user_consents_audited',
  'get_user_questionnaire_responses_audited',
  // Consent check je v CTE consented - filtruje na data_sharing_consents
  // Analyzer nedetekuje CTE-based consent check
  'get_consented_users_longevity_scores',

  // Admin funkce — consent check nahrazuje admin autorizace
  'get_members_summary_admin',
  'get_mobile_api_stats',

  // get_my_* — přístup k vlastním datům, consent nepotřebný (auth.uid() = vlastník)
  'get_mobile_dashboard_data',
  'get_my_activity_timeline',
  'get_my_gamification_stats',
  'get_my_health_check_ins_audited',
  'get_my_health_trends',
  'get_my_lab_results_audited',
  'check_user_achievements',

  // Partner funkce — consent validován server-side v CTE/JOIN
  'get_partner_recent_check_ins_audited',
  'get_partner_recent_lab_results_audited',
  'get_partner_recent_user_data',

  // Bulk/sync — volány přes secure mode, auth+consent je v hook vrstvě
  'health_data_bulk_upload',
  'sync_health_data_with_conflict_resolution',

  // Trigger funkce — volány DB interně
  'trigger_timeline_health_check_in',
  'trigger_timeline_lab_result',
] as const;

// ---------------------------------------------------------------------------
// Hooky bez auth check - analyzer nedetekuje alternativní patterns
// ---------------------------------------------------------------------------
export const KNOWN_HOOKS_NO_AUTH = [
  // Tyto hooky mají auth check přes usePermissions() nebo useSecureMode()
  // které analyzer nedetekuje (hledá pouze useSession)
  'useAggregateTrackingData',    // Má usePermissions().hasPermission("view_admin_dashboard") check
  'useDeleteTrackingDocument',   // Má useSecureMode() fail-closed check
  'useContributeToStatistics', // Má useSecureMode() fail-closed check

  // Intentionally public data (GRANT TO PUBLIC) — no auth required by design
  'useBiomarkerReferenceRanges',
  // RPC funkce validuje auth.uid() + is_admin_or_staff() server-side
  'useLabResultDetail',
] as const;

// ---------------------------------------------------------------------------
// Source-truth: Známé nesoulady frontend ↔ SQL parametrů
// Pre-existing issues — frontend i SQL fungují v produkci, param mapping je buď:
//   - extra params ignorované PostgreSQL
//   - naming convention mismatch (p_foo vs foo)
//   - Optional params with DEFAULT hodnoty v SQL
// ---------------------------------------------------------------------------
export const KNOWN_WRONG_PARAM_FUNCTIONS = [
  'upsert_notification_campaign_admin',      // Extra params (audience_type, base_locale, body_key, description)
  'get_production_workflow_templates_admin',  // Volání bez params kde SQL neočekává
  'create_product_admin',                    // p_* vs non-prefixed naming mismatch
  'update_product_admin',                    // p_* vs non-prefixed naming mismatch
  'save_health_metric_audited',              // p_notes extra
  'get_token_leaderboard',                   // Volání bez params kde SQL neočekává
  'get_my_leaderboard_position',             // Volání bez params kde SQL neočekává
  'log_health_state_audited',                // p_state_id extra
  'create_member_product_plan_audited',      // p_notes extra
  'confirm_product_taken_audited',           // p_dose_taken, p_notes extra
  'create_member_widget_audited',            // row, col, width, height naming mismatch
  'get_production_logs_admin',               // Volání bez params kde SQL neočekává
  'update_role_definition',                  // p_can_view_sensitive_data extra
] as const;

export const KNOWN_MISSING_PARAM_FUNCTIONS = [
  'upsert_product_catalog_admin',            // description, en - JSON nested params
  'upsert_symptom_catalog_admin',            // description, en - JSON nested params
  'create_member_widget_audited',            // p_widget_type, col - naming convention
  'create_story_entry_audited',              // p_story_id - params restructured
  'extract_training_pairs_from_kb',          // Analyzer false positive: mis-parses SQL ARRAY['a','b'] default
] as const;

// Chybějící RLS politiky (INSERT/UPDATE/DELETE)
export const KNOWN_MISSING_RLS_POLICIES = [
  // Tyto tabulky používají pouze RPC pro mutace
  // RLS politiky nejsou nutné protože přímý INSERT/UPDATE/DELETE není povolen
  { table: 'consents', operation: 'INSERT' },
  { table: 'consents', operation: 'UPDATE' },
  { table: 'consents', operation: 'DELETE' },
  { table: 'dosing_logs', operation: 'INSERT' },
  { table: 'dosing_logs', operation: 'UPDATE' },
  { table: 'dosing_logs', operation: 'DELETE' },
  { table: 'health_check_ins', operation: 'INSERT' },
  { table: 'health_check_ins', operation: 'UPDATE' },
  { table: 'health_check_ins', operation: 'DELETE' },
  { table: 'lab_results', operation: 'INSERT' },
  { table: 'lab_results', operation: 'UPDATE' },
  { table: 'lab_results', operation: 'DELETE' },
  { table: 'questionnaire_responses', operation: 'INSERT' },
  { table: 'questionnaire_responses', operation: 'UPDATE' },
  { table: 'questionnaire_responses', operation: 'DELETE' },
  // profiles - mutace jdou přes RPC funkce (upsert_my_profile_phi, update_my_profile_*)
  { table: 'profiles', operation: 'INSERT' },
  { table: 'profiles', operation: 'UPDATE' },
  { table: 'profiles', operation: 'DELETE' },
] as const;

/**
 * Helper pro kontrolu jestli je problém v known issues
 */
export function isKnownAnonGrantFunction(fn: string): boolean {
  return KNOWN_ANON_GRANT_FUNCTIONS.includes(fn as typeof KNOWN_ANON_GRANT_FUNCTIONS[number]);
}

export function isKnownNoAuthFunction(fn: string): boolean {
  return KNOWN_NO_AUTH_FUNCTIONS.includes(fn as typeof KNOWN_NO_AUTH_FUNCTIONS[number]);
}

export function isKnownNoConsentFunction(fn: string): boolean {
  return KNOWN_NO_CONSENT_FUNCTIONS.includes(fn as typeof KNOWN_NO_CONSENT_FUNCTIONS[number]);
}

export function isKnownPhiTableNoRls(table: string): boolean {
  return KNOWN_PHI_TABLES_NO_RLS.some(t => t.table === table);
}

export function isKnownMissingRlsPolicy(table: string, operation: string): boolean {
  return KNOWN_MISSING_RLS_POLICIES.some(p => p.table === table && p.operation === operation);
}

export function isKnownHookNoAuth(hook: string): boolean {
  // Report used full paths (src/hooks/useXyz.ts), known-issues uses just the hook name
  const basename = hook.replace(/^.*\//, '').replace(/\.\w+$/, '');
  return KNOWN_HOOKS_NO_AUTH.includes(basename as typeof KNOWN_HOOKS_NO_AUTH[number]);
}

export function isKnownWrongParamFunction(fn: string): boolean {
  return KNOWN_WRONG_PARAM_FUNCTIONS.includes(fn as typeof KNOWN_WRONG_PARAM_FUNCTIONS[number]);
}

export function isKnownMissingParamFunction(fn: string): boolean {
  return KNOWN_MISSING_PARAM_FUNCTIONS.includes(fn as typeof KNOWN_MISSING_PARAM_FUNCTIONS[number]);
}
