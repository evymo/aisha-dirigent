/**
 * Agent Activity Stream — real-time feed of agent actions on the canvas.
 *
 * Subscribes to Supabase Realtime broadcasts on the
 * `story:{storyId}:canvas` channel and displays a timeline
 * of agent events (block added, property changed, etc.).
 *
 * @module
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot } from "lucide-react";
import { aisha } from "@/integrations/db/client";

// =====================================================
// Types
// =====================================================

interface AgentActivityStreamProps {
  /** Story UUID to subscribe to */
  storyId: string;
}

/** Agent event types */
type AgentEventType =
  | "block_added"
  | "block_removed"
  | "property_changed"
  | "approved"
  | "rejected"
  | "occipitum_proposal";

/** A single agent activity event */
interface AgentEvent {
  /** Agent slug (e.g. "dev_patch", "compliance_gate") */
  agent: string;
  /** Block type or component label */
  block?: string;
  /** Unique event ID */
  id: string;
  /** Optional property name for property_changed events */
  property?: string;
  /** Timestamp */
  timestamp: string;
  /** Event type */
  type: AgentEventType;
}

/** Agent-to-color mapping */
const AGENT_COLORS: Record<string, string> = {
  aisha_planner: "text-purple-500",
  compliance_gate: "text-orange-500",
  debug_agent: "text-red-500",
  dev_patch: "text-blue-500",
  dirigent: "text-indigo-500",
  librarian: "text-teal-500",
  occipitum: "text-violet-400",
  verifier: "text-green-500",
};

/** i18n key mapping for event types */
const EVENT_I18N_KEYS: Record<AgentEventType, string> = {
  approved: "builder.agents.approved",
  block_added: "builder.agents.blockAdded",
  block_removed: "builder.agents.blockRemoved",
  occipitum_proposal: "builder.agents.occipitumProposal",
  property_changed: "builder.agents.propertyChanged",
  rejected: "builder.agents.rejected",
};

// =====================================================
// Component
// =====================================================

/**
 * Real-time agent activity stream for the canvas builder.
 *
 * Shows a compact timeline of agent actions. Events are received
 * via Supabase Realtime broadcast channel.
 */
export function AgentActivityStream({ storyId }: AgentActivityStreamProps) {
  const { t } = useTranslation();
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const addEvent = useCallback((event: AgentEvent) => {
    setEvents((prev) => [...prev.slice(-49), event]);
  }, []);

  // Subscribe to canvas activity via Realtime postgres_changes
  useEffect(() => {
    const channelName = `story:${storyId}:canvas`;

    const channel = aisha
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "partner_stories",
          filter: `id=eq.${storyId}`,
        },
        (payload) => {
          const data = payload.new as unknown as Partial<AgentEvent>;
          if (data.agent && data.type && data.id) {
            addEvent({
              agent: data.agent,
              block: data.block,
              id: data.id,
              property: data.property,
              timestamp: data.timestamp ?? new Date().toISOString(),
              type: data.type,
            });
          }
        },
      )
      .subscribe();

    return () => {
      void aisha.removeChannel(channel);
    };
  }, [addEvent, storyId]);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  if (events.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-border bg-muted/30">
      <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <Bot className="h-3.5 w-3.5" />
        {t("builder.panels.activity")}
      </div>
      <div
        ref={scrollRef}
        className="max-h-[120px] overflow-y-auto px-3 pb-2 space-y-1"
      >
        {events.map((event) => {
          const colorClass = AGENT_COLORS[event.agent] ?? "text-muted-foreground";
          const i18nKey = EVENT_I18N_KEYS[event.type];

          return (
            <div key={event.id} className="flex items-center gap-2 text-xs">
              <span className={`font-medium ${colorClass}`}>
                {event.agent}
              </span>
              <span className="text-muted-foreground">
                {t(i18nKey, {
                  agent: event.agent,
                  block: event.block ?? "?",
                  property: event.property,
                })}
              </span>
              <span className="ml-auto text-muted-foreground/60 tabular-nums">
                {formatRelativeTime(event.timestamp)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Format a timestamp as relative time (e.g. "12s", "2m").
 */
function formatRelativeTime(timestamp: string): string {
  const diff = Math.max(0, Date.now() - new Date(timestamp).getTime());
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}
