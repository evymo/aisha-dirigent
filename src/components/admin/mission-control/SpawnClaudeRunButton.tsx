import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSpawnClaudeRun } from "@/hooks/useSpawnClaudeRun";

/**
 * Component 4 producer surface — spawn an AISHA-driven Claude CLI run for a story.
 * Creates a queued agent_runs row via fn_spawn_claude_cli_run (story-scoped spend
 * admission applies); the svc-agent-runner poller executes it and the live session
 * surfaces in this same Mission Control.
 */
export function SpawnClaudeRunButton({ storyId }: { storyId?: string | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const spawn = useSpawnClaudeRun();

  const handleSpawn = (): void => {
    spawn.mutate(
      { prompt, storyId: storyId ?? null },
      {
        onSuccess: (runId) => {
          toast.success(t("missionControl.spawnClaude.success", { id: String(runId).slice(0, 8) }));
          setOpen(false);
          setPrompt("");
        },
        onError: (e: unknown) =>
          toast.error(t("missionControl.spawnClaude.error", { msg: e instanceof Error ? e.message : String(e) })),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-test="spawn-claude-run">
          {t("missionControl.spawnClaude.button")}
        </Button>
      </DialogTrigger>
      <DialogContent data-test="spawn-claude-dialog">
        <DialogHeader>
          <DialogTitle>{t("missionControl.spawnClaude.title")}</DialogTitle>
          <DialogDescription>{t("missionControl.spawnClaude.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="spawn-claude-prompt">{t("missionControl.spawnClaude.promptLabel")}</Label>
          <Textarea
            id="spawn-claude-prompt"
            data-test="spawn-claude-prompt"
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("missionControl.spawnClaude.promptPlaceholder")}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("missionControl.spawnClaude.cancel")}
          </Button>
          <Button
            data-test="spawn-claude-submit"
            disabled={!prompt.trim() || spawn.isPending}
            onClick={handleSpawn}
          >
            {spawn.isPending
              ? t("missionControl.spawnClaude.spawning")
              : t("missionControl.spawnClaude.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
