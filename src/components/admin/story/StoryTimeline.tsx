/**
 * StoryTimeline — chronological feed of trace events + rollbacks + B/G
 * switches for one story. Realtime via useStoryTimeline.
 */
import { useTranslation } from "react-i18next";

import { useStoryTimeline } from "@/hooks/useStoryTimeline";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { PatchEventCard } from "./PatchEventCard";

export interface StoryTimelineProps {
  storyId: string;
}

export function StoryTimeline({ storyId }: StoryTimelineProps) {
  const { t } = useTranslation();
  const { data: events = [], isLoading, error } = useStoryTimeline({
    storyId,
    limit: 100,
  });

  if (isLoading) {
    return (
      <div className="space-y-2" data-test="story-timeline-loading">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  if (events.length === 0) {
    return (
      <Alert data-test="story-timeline-empty">
        <AlertDescription>
          {t(
            "storyDetail.timeline.empty",
            "No events recorded for this story yet. AISHA will populate this feed as she works.",
          )}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-2" data-test="story-timeline">
      {events.map((event) => (
        <PatchEventCard key={event.event_id} event={event} />
      ))}
    </div>
  );
}
