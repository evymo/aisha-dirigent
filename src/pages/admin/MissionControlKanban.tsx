/**
 * MissionControlKanban — `/admin/mission-control/kanban` landing.
 *
 * Hosts the KanbanBoard inside the standard admin chrome. The board does
 * the heavy lifting (live data, DnD, transition validation); this file
 * is intentionally thin so each piece tests in isolation.
 */
import { useTranslation } from "react-i18next";
import { KanbanSquare } from "lucide-react";

import { KanbanBoard } from "@/components/admin/kanban/KanbanBoard";

export default function MissionControlKanban() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4 p-6" data-test="mission-control-kanban-page">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <KanbanSquare className="size-6" aria-hidden="true" />
          {t("kanban.pageTitle", "Stories kanban")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(
            "kanban.pageSubtitle",
            "Drag a story across columns to change its kanban status. Transition rules + admin gating are enforced server-side.",
          )}
        </p>
      </header>

      <KanbanBoard />
    </div>
  );
}
