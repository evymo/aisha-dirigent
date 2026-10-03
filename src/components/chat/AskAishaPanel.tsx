import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * One starter question. `label` is the exact text sent to the chat when tapped
 * (chip text == prompt). `roles` gate visibility (omit = everyone).
 */
export interface AskStarter {
  id: string;
  label: string;
  roles?: string[];
}

export interface AskAishaPanelProps {
  /** Starter questions to offer. Role-filtered here; already-localised text. */
  starters: AskStarter[];
  /** Fired with the chosen prompt text — wire to the existing chat send. */
  onSelect: (prompt: string) => void;
  /** Role predicate from the session; used to filter role-gated starters. */
  hasRole?: (role: string) => boolean;
  /** Disable chips (e.g. while the chat is not usable / sending). */
  disabled?: boolean;
  className?: string;
}

/**
 * AskAishaPanel — role-scoped starter chips shown in the chat's empty state.
 *
 * Pure presentation over the EXISTING chat send path: a chip's tap sends its
 * text through whatever `onSelect` the host wires (svc-ai-chat → dispatcher →
 * agent_tools → li_*, the verified live chain). It adds NO endpoint, hook or
 * block-type. The starter TEXT is data: generic defaults ship in the platform
 * locale, instance-specific prompts come from instance-data — this component
 * only renders what it is given.
 */
export function AskAishaPanel({ starters, onSelect, hasRole, disabled, className }: AskAishaPanelProps) {
  const visible = starters.filter(
    (s) => !s.roles?.length || (hasRole ? s.roles.some((r) => hasRole(r)) : true),
  );
  if (visible.length === 0) return null;

  return (
    <div className={cn("mt-6 flex flex-wrap justify-center gap-2", className)}>
      {visible.map((s) => (
        <Button
          key={s.id}
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onSelect(s.label)}
          className="rounded-full font-normal"
        >
          {s.label}
        </Button>
      ))}
    </div>
  );
}
