import { NavLink, useLocation } from "react-router-dom";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";
import { adminNavGroups, getVisibleAdminNavGroups } from "./adminNavConfig";

/** Admin sidebar with collapsible navigation groups */
export function AdminSidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const { state } = useSidebar();
  const { hasPermission } = usePermissions();
  const canManageAll = hasPermission("manage_permissions");
  const collapsed = state === "collapsed";
  
  // Track which groups are open
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    // Default all groups to open
    const initial: Record<string, boolean> = {};
    adminNavGroups.forEach(group => {
      initial[group.titleKey] = true;
    });
    return initial;
  });

  const toggleGroup = (titleKey: string) => {
    setOpenGroups(prev => ({ ...prev, [titleKey]: !prev[titleKey] }));
  };

  const isActive = (path: string) => {
    if (path === "/admin") {
      return location.pathname === "/admin";
    }
    return location.pathname.startsWith(path);
  };

  return (
    <Sidebar className={collapsed ? "w-14" : "w-60"} collapsible="icon">
      <SidebarContent className="flex flex-col h-full overflow-hidden">
        <SidebarGroup className="flex-shrink-0">
          <SidebarGroupLabel className="flex items-center justify-between">
            {!collapsed && <span>{t("admin.sidebar.title")}</span>}
            <SidebarTrigger className="h-5 w-5" />
          </SidebarGroupLabel>
        </SidebarGroup>

        <ScrollArea className="flex-1 px-2">
          <div className="space-y-2 py-2">
            {getVisibleAdminNavGroups({ canManageAll, hasPermission }).map((group) => {
              const visibleItems = group.items;
              
              // Skip group if no visible items
              if (visibleItems.length === 0) return null;
              
              const groupTitle = t(`admin.sidebar.groups.${group.titleKey}`);
              
              return (
                <Collapsible
                  key={group.titleKey}
                  open={collapsed ? false : openGroups[group.titleKey]}
                  onOpenChange={() => !collapsed && toggleGroup(group.titleKey)}
                >
                  {!collapsed && (
                    <CollapsibleTrigger className="flex w-full items-center justify-between px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
                      <span>{groupTitle}</span>
                      {openGroups[group.titleKey] ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                    </CollapsibleTrigger>
                  )}
                  <CollapsibleContent>
                    <SidebarMenu>
                      {visibleItems.map((item) => (
                        <SidebarMenuItem key={item.titleKey}>
                          <SidebarMenuButton
                            asChild
                            isActive={isActive(item.url)}
                            className={cn(
                              "transition-colors",
                              isActive(item.url) && "bg-primary/10 text-primary"
                            )}
                          >
                            <NavLink to={item.url} end={item.url === "/admin"}>
                              <item.icon className="h-4 w-4" />
                              {!collapsed && (
                                <span>{item.labelKey ? t(item.labelKey) : t(`admin.sidebar.items.${item.titleKey}`)}</span>
                              )}
                            </NavLink>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </CollapsibleContent>
                  {/* Show items directly when collapsed */}
                  {collapsed && (
                    <SidebarMenu>
                      {visibleItems.map((item) => (
                        <SidebarMenuItem key={item.titleKey}>
                          <SidebarMenuButton
                            asChild
                            isActive={isActive(item.url)}
                          >
                            <NavLink to={item.url} end={item.url === "/admin"}>
                              <item.icon className="h-4 w-4" />
                            </NavLink>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  )}
                </Collapsible>
              );
            })}
          </div>
        </ScrollArea>

        <SidebarGroup className="mt-auto flex-shrink-0 border-t">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink to="/">
                    <ArrowLeft className="h-4 w-4" />
                    {!collapsed && <span>{t("admin.sidebar.items.backToSite")}</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
