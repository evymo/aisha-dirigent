/**
 * StoryTimelineTab — Phase 4 timeline + branch/deploy rail tab.
 *
 * Layout: rail on the right (md+), feed taking the remaining width. On
 * narrow screens the rail collapses above the feed.
 */
import { useTranslation } from "react-i18next";
import { History } from "lucide-react";

import { StoryTimeline } from "./StoryTimeline";
import { BranchDeployRail } from "./BranchDeployRail";

export interface StoryTimelineTabProps {
  storyId: string;
}

export function StoryTimelineTab({ storyId }: StoryTimelineTabProps) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_320px]" data-test="story-timeline-tab">
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <History className="size-4" aria-hidden="true" />
          {t("storyDetail.timeline.feedTitle", "Activity feed")}
        </h3>
        <StoryTimeline storyId={storyId} />
      </section>
      <aside>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">
          {t("storyDetail.timeline.railTitle", "Branch + deploy")}
        </h3>
        <BranchDeployRail storyId={storyId} />
      </aside>
    </div>
  );
}
