/**
 * HeaderUserSection - Authenticated user menu section
 * 
 * This component is lazy-loaded only when user is authenticated.
 * It contains membership/partner hooks that would otherwise
 * bloat the initial bundle for anonymous visitors.
 */
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  User,
  LogOut,
  Settings,
  MessageSquare,
  ClipboardList,
  GraduationCap,
  LayoutDashboard,
  Crown,
  Shield,
  Package,
  Coins,
  Calendar,
  Building,
  FlaskConical,
  Trophy,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { useSession } from "@/hooks/useSession";
import { useMembership } from "@/hooks/useMembership";
import { usePermissions } from "@/hooks/usePermissions";
import type { KcUser as SupabaseUser } from "@/integrations/auth/types";

interface HeaderUserSectionProps {
  user: SupabaseUser;
}

export function HeaderUserSection({ user }: HeaderUserSectionProps) {
  const { t } = useTranslation();
  const { signOut } = useSession();
  const { hasPermission, hasAnyPermission } = usePermissions();
  const { membership } = useMembership();

  const isStaff = hasAnyPermission("view_admin_dashboard", "view_staff_dashboard");
  const isAdmin = hasPermission("manage_permissions");
  const canAccessPartnerDashboard = hasPermission("view_partner_dashboard");
  const canAccessPartnerStoryLoop = hasAnyPermission(
    "view_partner_dashboard",
    "view_assigned_members",
    "view_admin_dashboard",
    "view_staff_dashboard"
  );
  const isUpgraded = membership?.tier === "upgraded";
  const userInitial = user.email?.charAt(0).toUpperCase() || "U";
  const membershipLabel = membership?.tier
    ? membership.tier.charAt(0).toUpperCase() + membership.tier.slice(1)
    : t("header.basicMembership");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-full hover:bg-primary/10"
          aria-label="Open user menu"
          data-testid="user-menu"
        >
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
              {userInitial}
            </AvatarFallback>
          </Avatar>
          {isUpgraded && (
            <Crown className="absolute -top-1 -right-1 h-4 w-4 text-amber-500" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-xl">
        {/* User Info */}
        <DropdownMenuLabel className="font-normal p-4">
          <div className="flex flex-col space-y-2">
            <p className="text-sm font-medium truncate">{user.email}</p>
            <div className="flex items-center gap-2">
              <Badge
                variant={isUpgraded ? "default" : "secondary"}
                className="text-xs rounded-full"
              >
                {membershipLabel}
              </Badge>
              {isAdmin && (
                <Badge variant="outline" className="text-xs rounded-full">
                  <Shield className="w-3 h-3 mr-1" />
                  Admin
                </Badge>
              )}
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Member Section */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground px-4">
            {t("header.memberSection")}
          </DropdownMenuLabel>
          <DropdownMenuItem asChild className="rounded-lg mx-2">
            <Link to="/member" className="cursor-pointer">
              <LayoutDashboard className="mr-2 h-4 w-4" />
              {t("header.dashboard")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="rounded-lg mx-2">
            <Link to="/member/story" className="cursor-pointer">
              <MessageSquare className="mr-2 h-4 w-4" />
              {t("myTimeline.title")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="rounded-lg mx-2">
            <Link to="/agents" className="cursor-pointer">
              <Bot className="mr-2 h-4 w-4" />
              {t("guild.agents.title")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="rounded-lg mx-2">
            <Link to="/member/profile" className="cursor-pointer">
              <User className="mr-2 h-4 w-4" />
              {t("header.profile")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="rounded-lg mx-2">
            <Link to="/member/orders" className="cursor-pointer">
              <Package className="mr-2 h-4 w-4" />
              {t("header.orders")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="rounded-lg mx-2">
            <Link to="/member/tokens" className="cursor-pointer">
              <Coins className="mr-2 h-4 w-4" />
              {t("header.tokens")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="rounded-lg mx-2">
            <Link to="/member/leaderboard" className="cursor-pointer">
              <Trophy className="mr-2 h-4 w-4" />
              {t("gamification.leaderboard.title")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="rounded-lg mx-2">
            <Link to="/member/appointments" className="cursor-pointer">
              <Calendar className="mr-2 h-4 w-4" />
              {t("header.appointments")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="rounded-lg mx-2">
            <Link to="/member/questionnaires" className="cursor-pointer">
              <ClipboardList className="mr-2 h-4 w-4" />
              {t("header.questionnaires")}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />

        {/* Study & Qualification */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground px-4">
            {t("header.studiesSection")}
          </DropdownMenuLabel>
          <DropdownMenuItem asChild className="rounded-lg mx-2">
            <Link to="/studies" className="cursor-pointer">
              <FlaskConical className="mr-2 h-4 w-4" />
              {t("header.browseStudies")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="rounded-lg mx-2">
            <Link to="/study-registration" className="cursor-pointer">
              <ClipboardList className="mr-2 h-4 w-4" />
              {t("header.enrollStudy")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="rounded-lg mx-2">
            <Link to="/qualification-test" className="cursor-pointer">
              <GraduationCap className="mr-2 h-4 w-4" />
              {t("header.qualificationTest")}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        {/* Partner Section */}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground px-4">
            {t("header.partnerSection")}
          </DropdownMenuLabel>
          {canAccessPartnerStoryLoop ? (
            <>
              {canAccessPartnerDashboard && (
                <DropdownMenuItem asChild className="rounded-lg mx-2">
                  <Link to="/partner/dashboard" className="cursor-pointer">
                    <Building className="mr-2 h-4 w-4" />
                    {t("header.partnerDashboard")}
                  </Link>
                </DropdownMenuItem>
              )}
              {canAccessPartnerDashboard && (
                <DropdownMenuItem asChild className="rounded-lg mx-2">
                  <Link to="/partner/agents" className="cursor-pointer">
                    <Bot className="mr-2 h-4 w-4" />
                    {t("guild.myAgents.title")}
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem asChild className="rounded-lg mx-2">
                <Link to="/partner/storyloop" className="cursor-pointer">
                  <MessageSquare className="mr-2 h-4 w-4" />
                  {t("storyloop.title")}
                </Link>
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem asChild className="rounded-lg mx-2">
              <Link to="/partner-certification" className="cursor-pointer">
                <GraduationCap className="mr-2 h-4 w-4" />
                {t("header.partnerCertification")}
              </Link>
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>

        {/* Admin Section */}
        {(isAdmin || isStaff) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground px-4">
                {t("header.adminSection")}
              </DropdownMenuLabel>
              <DropdownMenuItem asChild className="rounded-lg mx-2">
                <Link to="/admin" className="cursor-pointer">
                  <Settings className="mr-2 h-4 w-4" />
                  {t("header.adminDashboard")}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => signOut()}
          className="text-destructive rounded-lg mx-2 mb-2"
        >
          <LogOut className="mr-2 h-4 w-4" />
          {t("header.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Mobile version of the user section for authenticated users.
 * Contains all the member/partner/admin navigation links.
 */
interface MobileUserSectionProps {
  user: SupabaseUser;
  onNavigate: () => void;
}

export function MobileUserSection({ user, onNavigate }: MobileUserSectionProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const { signOut } = useSession();
  const { hasPermission, hasAnyPermission } = usePermissions();
  const { membership } = useMembership();

  const isStaff = hasAnyPermission("view_admin_dashboard", "view_staff_dashboard");
  const isAdmin = hasPermission("manage_permissions");
  const canAccessPartnerDashboard = hasPermission("view_partner_dashboard");
  const canAccessPartnerStoryLoop = hasAnyPermission(
    "view_partner_dashboard",
    "view_assigned_members",
    "view_admin_dashboard",
    "view_staff_dashboard"
  );
  const isUpgraded = membership?.tier === "upgraded";
  const userInitial = user.email?.charAt(0).toUpperCase() || "U";
  const membershipLabel = membership?.tier
    ? membership.tier.charAt(0).toUpperCase() + membership.tier.slice(1)
    : t("header.basicMembership");

  const linkClass = (path: string) =>
    `flex items-center gap-3 px-4 py-3 text-base font-medium rounded-xl transition-colors ml-2 ${location.pathname === path
      ? "text-primary bg-primary/10"
      : "text-foreground/70 hover:text-foreground hover:bg-muted/50"
    }`;

  return (
    <>
      {/* User Info */}
      <div className="flex items-center gap-3 px-4 py-4 bg-muted/30 rounded-xl mb-4">
        <Avatar className="h-12 w-12">
          <AvatarFallback className="bg-primary/10 text-primary font-medium">
            {userInitial}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{user.email}</p>
          <div className="flex items-center gap-2 mt-1">
            <Badge
              variant={isUpgraded ? "default" : "secondary"}
              className="text-xs rounded-full"
            >
              {membershipLabel}
            </Badge>
            {isAdmin && (
              <Badge variant="outline" className="text-xs rounded-full">
                Admin
              </Badge>
            )}
          </div>
        </div>
        {isUpgraded && <Crown className="h-5 w-5 text-amber-500" />}
      </div>

      {/* Member Section */}
      <div className="text-xs text-muted-foreground font-medium uppercase tracking-widest px-4 py-2">
        {t("header.memberSection")}
      </div>
      <Link to="/member" className={linkClass("/member")} onClick={onNavigate}>
        <LayoutDashboard className="h-5 w-5" />
        {t("header.dashboard")}
      </Link>
      <Link to="/member/story" className={linkClass("/member/story")} onClick={onNavigate}>
        <MessageSquare className="h-5 w-5" />
        {t("myTimeline.title")}
      </Link>
      <Link to="/member/profile" className={linkClass("/member/profile")} onClick={onNavigate}>
        <User className="h-5 w-5" />
        {t("header.profile")}
      </Link>
      <Link to="/member/orders" className={linkClass("/member/orders")} onClick={onNavigate}>
        <Package className="h-5 w-5" />
        {t("header.orders")}
      </Link>
      <Link to="/member/tokens" className={linkClass("/member/tokens")} onClick={onNavigate}>
        <Coins className="h-5 w-5" />
        {t("header.tokens")}
      </Link>
      <Link to="/member/leaderboard" className={linkClass("/member/leaderboard")} onClick={onNavigate}>
        <Trophy className="h-5 w-5" />
        {t("gamification.leaderboard.title")}
      </Link>
      <Link to="/member/appointments" className={linkClass("/member/appointments")} onClick={onNavigate}>
        <Calendar className="h-5 w-5" />
        {t("header.appointments")}
      </Link>

      {/* Study & Qualification */}
      <div className="text-xs text-muted-foreground font-medium uppercase tracking-widest px-4 py-2 mt-3">
        {t("header.studiesSection")}
      </div>
      <Link to="/studies" className={linkClass("/studies")} onClick={onNavigate}>
        <FlaskConical className="h-5 w-5" />
        {t("header.browseStudies")}
      </Link>
      <Link to="/study-registration" className={linkClass("/study-registration")} onClick={onNavigate}>
        <ClipboardList className="h-5 w-5" />
        {t("header.enrollStudy")}
      </Link>
      <Link to="/qualification-test" className={linkClass("/qualification-test")} onClick={onNavigate}>
        <GraduationCap className="h-5 w-5" />
        {t("header.qualificationTest")}
      </Link>

      {/* Partner Section */}
      <div className="text-xs text-muted-foreground font-medium uppercase tracking-widest px-4 py-2 mt-3">
        {t("header.partnerSection")}
      </div>
      {canAccessPartnerStoryLoop ? (
        <>
          {canAccessPartnerDashboard && (
            <Link to="/partner/dashboard" className={linkClass("/partner/dashboard")} onClick={onNavigate}>
              <Building className="h-5 w-5" />
              {t("header.partnerDashboard")}
            </Link>
          )}
          {canAccessPartnerDashboard && (
            <Link to="/partner/agents" className={linkClass("/partner/agents")} onClick={onNavigate}>
              <Bot className="h-5 w-5" />
              {t("guild.myAgents.title")}
            </Link>
          )}
          <Link to="/partner/storyloop" className={linkClass("/partner/storyloop")} onClick={onNavigate}>
            <MessageSquare className="h-5 w-5" />
            {t("storyloop.title")}
          </Link>
        </>
      ) : (
        <Link to="/partner-certification" className={linkClass("/partner-certification")} onClick={onNavigate}>
          <GraduationCap className="h-5 w-5" />
          {t("header.partnerCertification")}
        </Link>
      )}

      {/* Admin Section */}
      {(isAdmin || isStaff) && (
        <>
          <div className="text-xs text-muted-foreground font-medium uppercase tracking-widest px-4 py-2 mt-3">
            {t("header.adminSection")}
          </div>
          <Link to="/admin" className={linkClass("/admin")} onClick={onNavigate}>
            <Settings className="h-5 w-5" />
            {t("header.adminDashboard")}
          </Link>
        </>
      )}

      {/* Sign Out */}
      <div className="mt-auto pt-6">
        <button
          onClick={() => {
            signOut();
            onNavigate();
          }}
          className="flex items-center gap-3 px-4 py-3.5 w-full text-base font-medium text-destructive rounded-xl transition-colors hover:bg-destructive/10"
        >
          <LogOut className="h-5 w-5" />
          {t("header.signOut")}
        </button>
      </div>
    </>
  );
}
