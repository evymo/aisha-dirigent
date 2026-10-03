-- Enum: ai_event_type

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_event_type') THEN
    CREATE TYPE ai_event_type AS ENUM (
      'llm_call',
  'mcp_call',
  'tool_call',
  'patch_applied',
  'test_run',
  'deploy',
  'quality_gate',
  'human_approval',
  'route_decision',
  'context_compose',
  'compliance_check',
  'evaluation',
  'proactive_trigger',
  'proactive_evaluation',
  'scheduled_job',
  'study_monitor',
  'memory_read',
  'memory_write',
  'task_checkpoint',
  'react_thought',
  'workflow_start',
  'workflow_node',
  'workflow_transition',
  'parallel_fanout',
  'critic_review',
  'dirigent_action',
  'n8n_workflow',
  'escalation',
  'notification',
  'moderation_decision',
  'improvement_proposal',
  'route_plan_override',
  'route_plan_classify_bypass',
  'dev_signal'
    );
  END IF;
END $$;
