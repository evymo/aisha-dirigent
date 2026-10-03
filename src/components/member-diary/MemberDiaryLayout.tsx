/**
 * Member Diary Layout
 * Three-panel layout for member health diary and product tracking
 */

import { ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Pill,
  Heart,
  Calendar,
  LayoutGrid,
  Package,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

export type DiarySection = "products" | "health-states" | "calendar" | "dashboard" | "distributions";

interface MemberDiaryLayoutProps {
  activeSection: DiarySection;
  onSectionChange: (section: DiarySection) => void;
  listContent: ReactNode;
  detailContent: ReactNode;
  listTitle?: string;
}

const sectionIcons: Record<DiarySection, typeof Pill> = {
  products: Pill,
  "health-states": Heart,
  calendar: Calendar,
  dashboard: LayoutGrid,
  distributions: Package,
};

export function MemberDiaryLayout({
  activeSection,
  onSectionChange,
  listContent,
  detailContent,
  listTitle,
}: MemberDiaryLayoutProps) {
  const { t } = useTranslation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const sections: { key: DiarySection; labelKey: string }[] = [
    { key: "dashboard", labelKey: "memberDiary.dashboard" },
    { key: "products", labelKey: "memberDiary.products" },
    { key: "health-states", labelKey: "memberDiary.healthStates" },
    { key: "calendar", labelKey: "memberDiary.calendar" },
    { key: "distributions", labelKey: "memberDiary.distributions" },
  ];

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-background">
      {/* Sidebar - Section Navigation */}
      <aside
        className={cn(
          "border-r border-border bg-card transition-all duration-300",
          sidebarCollapsed ? "w-16" : "w-56"
        )}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between p-4 border-b border-border">
            {!sidebarCollapsed && (
              <h2 className="font-semibold text-foreground truncate">
                {t("memberDiary.title")}
              </h2>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="shrink-0"
            >
              {sidebarCollapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </Button>
          </div>
          <nav className="flex-1 p-2 space-y-1">
            {sections.map((section) => {
              const Icon = sectionIcons[section.key];
              return (
                <Button
                  key={section.key}
                  variant={activeSection === section.key ? "secondary" : "ghost"}
                  className={cn(
                    "w-full justify-start",
                    sidebarCollapsed && "justify-center px-2"
                  )}
                  onClick={() => onSectionChange(section.key)}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!sidebarCollapsed && (
                    <span className="ml-2 truncate">{t(section.labelKey)}</span>
                  )}
                </Button>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* List Panel */}
      <div className="w-80 border-r border-border bg-card/50 flex flex-col">
        {listTitle && (
          <div className="p-4 border-b border-border">
            <h3 className="font-medium text-foreground">{listTitle}</h3>
          </div>
        )}
        <ScrollArea className="flex-1">{listContent}</ScrollArea>
      </div>

      {/* Detail Panel */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">{detailContent}</ScrollArea>
      </div>
    </div>
  );
}
