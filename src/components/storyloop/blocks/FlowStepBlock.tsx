/**
 * FlowStepBlock — renders a Flowboard run's provenance in the StoryLoop:
 * the `flow_run` umbrella and each `automation_step`. Read-only; the executor
 * writes these via create_story_entry_audited. The lucide icon NAME comes from
 * metadata.flowboard.icon (mirrors the executor's KIND_ICON).
 */
import { useTranslation } from 'react-i18next';
import { Play, Bot, Wrench, FileText, GitBranch, Lock, Zap, Workflow, type LucideIcon } from 'lucide-react';
import { CommunicationBlockTemplate } from './CommunicationBlockTemplate';

const ICON_BY_NAME: Record<string, LucideIcon> = {
  play: Play,
  bot: Bot,
  wrench: Wrench,
  'file-text': FileText,
  'git-branch': GitBranch,
  lock: Lock,
  zap: Zap,
};

interface FlowStepMetadata {
  flowboard?: {
    kind?: string;
    icon?: string;
    status?: string;
    output?: string | null;
  };
}

interface Props {
  metadata: Record<string, unknown>;
  content?: string;
}

export function FlowStepBlock({ metadata, content }: Props) {
  const { t } = useTranslation();
  const fb = (metadata.flowboard ?? {}) as NonNullable<FlowStepMetadata['flowboard']>;
  const Icon = ICON_BY_NAME[fb.icon ?? ''] ?? Workflow;
  const isRun = fb.kind === 'flow_run';
  const status = fb.status ?? (isRun ? 'running' : 'executed');

  const statusClassName =
    status === 'error'
      ? 'bg-destructive/10 text-destructive border-destructive/20'
      : status === 'approved'
        ? 'bg-success/10 text-success border-success/20'
        : 'bg-muted text-muted-foreground';

  // The first content line is the human label ("<node> — <status>" / run header).
  const title = content?.split('\n')[0]?.trim() || t(isRun ? 'flowboard.block.runTitle' : 'flowboard.block.stepTitle');

  return (
    <CommunicationBlockTemplate
      cardClassName={isRun ? 'border-primary/30 bg-primary/5' : undefined}
      icon={<Icon className="h-4 w-4" aria-hidden="true" />}
      title={title}
      status={{ label: t(`flowboard.block.status.${status}`, status), className: statusClassName }}
      body={
        fb.output ? (
          <p className="whitespace-pre-wrap text-xs text-muted-foreground">{fb.output}</p>
        ) : undefined
      }
    />
  );
}
