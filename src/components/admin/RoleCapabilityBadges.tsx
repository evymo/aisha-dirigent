import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { 
  Tooltip, 
  TooltipContent, 
  TooltipProvider, 
  TooltipTrigger 
} from "@/components/ui/tooltip";
import { 
  Lock, 
  Crown, 
  Eye, 
  Download, 
  AlertTriangle,
  Users,
  Settings,
  Check,
  Minus,
} from "lucide-react";
import type { RoleDefinition } from "@/hooks/useRoleDefinitions";

interface RoleCapabilityBadgesProps {
  role: RoleDefinition;
  compact?: boolean;
}

/**
 * Displays compliance/SOC 2 compliant capability badges for a role
 * 
 * Shows visual indicators for:
 * - System role (locked, cannot be deleted)
 * - Admin privileges
 * - sensitive data access capabilities
 * - Export/break-glass permissions
 */
export function RoleCapabilityBadges({ role, compact = false }: RoleCapabilityBadgesProps) {
  const { t } = useTranslation();

  const capabilities = [
    {
      key: 'is_system',
      show: role.is_system,
      icon: Lock,
      label: t("admin.roles.capabilities.system"),
      tooltip: t("admin.roles.capabilities.systemTooltip"),
      color: "text-slate-500",
      severity: "info"
    },
    {
      key: 'is_admin',
      show: role.is_admin,
      icon: Crown,
      label: t("admin.roles.capabilities.admin"),
      tooltip: t("admin.roles.capabilities.adminTooltip"),
      color: "text-amber-500",
      severity: "warning"
    },
    {
      key: 'can_view_sensitive_data',
      show: role.can_view_sensitive_data,
      icon: Eye,
      label: t("admin.roles.capabilities.viewSensitiveData"),
      tooltip: t("admin.roles.capabilities.viewSensitiveDataTooltip"),
      color: "text-blue-500",
      severity: "info"
    },
    {
      key: 'can_export_phi',
      show: role.can_export_phi,
      icon: Download,
      label: t("admin.roles.capabilities.exportSensitiveData"),
      tooltip: t("admin.roles.capabilities.exportSensitiveDataTooltip"),
      color: "text-orange-500",
      severity: "warning"
    },
    {
      key: 'can_break_glass',
      show: role.can_break_glass,
      icon: AlertTriangle,
      label: t("admin.roles.capabilities.breakGlass"),
      tooltip: t("admin.roles.capabilities.breakGlassTooltip"),
      color: "text-red-500",
      severity: "critical"
    },
    {
      key: 'can_manage_users',
      show: role.can_manage_users,
      icon: Users,
      label: t("admin.roles.capabilities.manageUsers"),
      tooltip: t("admin.roles.capabilities.manageUsersTooltip"),
      color: "text-purple-500",
      severity: "warning"
    },
    {
      key: 'can_manage_roles',
      show: role.can_manage_roles,
      icon: Settings,
      label: t("admin.roles.capabilities.manageRoles"),
      tooltip: t("admin.roles.capabilities.manageRolesTooltip"),
      color: "text-indigo-500",
      severity: "warning"
    },
  ];

  const activeCapabilities = capabilities.filter(cap => cap.show);

  if (compact) {
    return (
      <TooltipProvider>
        <div className="flex items-center gap-1">
          {activeCapabilities.map(cap => (
            <Tooltip key={cap.key}>
              <TooltipTrigger>
                <cap.icon className={`w-3.5 h-3.5 ${cap.color}`} />
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-medium">{cap.label}</p>
                <p className="text-xs text-muted-foreground">{cap.tooltip}</p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
    );
  }

  return (
    <div className="flex flex-wrap gap-1">
      {activeCapabilities.map(cap => (
        <TooltipProvider key={cap.key}>
          <Tooltip>
            <TooltipTrigger>
              <Badge 
                variant="outline" 
                className={`gap-1 text-xs ${
                  cap.severity === 'critical' ? 'border-red-200 bg-red-50' :
                  cap.severity === 'warning' ? 'border-amber-200 bg-amber-50' :
                  'border-slate-200'
                }`}
              >
                <cap.icon className={`w-3 h-3 ${cap.color}`} />
                {cap.label}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>{cap.tooltip}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
    </div>
  );
}

/**
 * Summary card showing role capabilities overview
 */
export function RoleCapabilitySummary({ role }: { role: RoleDefinition }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{t("admin.roles.capabilities.secureAccess")}</span>
        {role.can_view_sensitive_data ? <Check className="h-4 w-4 text-green-600" /> : <Minus className="h-4 w-4 text-slate-400" />}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{t("admin.roles.capabilities.dataExport")}</span>
        {role.can_export_phi ? <Check className="h-4 w-4 text-orange-600" /> : <Minus className="h-4 w-4 text-slate-400" />}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{t("admin.roles.capabilities.emergencyAccess")}</span>
        {role.can_break_glass ? <Check className="h-4 w-4 text-red-600" /> : <Minus className="h-4 w-4 text-slate-400" />}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{t("admin.roles.capabilities.userManagement")}</span>
        {role.can_manage_users ? <Check className="h-4 w-4 text-purple-600" /> : <Minus className="h-4 w-4 text-slate-400" />}
      </div>
    </div>
  );
}
